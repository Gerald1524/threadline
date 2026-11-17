/**
 * Database access. One Postgres dialect, two drivers:
 *   - DATABASE_URL set  -> node-postgres: PostgreSQL 16 locally, Supabase or any managed Postgres
 *   - otherwise         -> PGlite, an embedded Postgres persisted under THREADLINE_DATA_DIR
 *                          (zero-setup fallback for demos and machines without Postgres)
 * The same migrations and queries run on both.
 */
import path from "node:path";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type DB = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Queryable = DB | Tx;

/**
 * Who a database handle acts for.
 *   - `{ orgId }` (pass the caller's AccessContext): the connection runs as the unprivileged
 *     role `threadline_app` with `app.org_id` set, so PostgreSQL row-level security confines
 *     every read and write to that organization (drizzle/0002_row_level_security.sql).
 *   - `"system"`: the owner connection. Only for work that is not on behalf of one
 *     organization: sign-in lookup, seeding, migrations, the import worker's queue, tests.
 * Property and role scoping inside an organization stay in src/lib/access.ts.
 */
export type DbScope = { orgId: string } | "system";
export const APP_ROLE = "threadline_app";
const SET_SCOPE = "select set_config('role', $1, $3), set_config('app.org_id', $2, $3)";

type Holder = { db?: Promise<DB>; close?: () => Promise<void>; makeTenant?: (orgId: string) => DB; tenants?: Map<string, DB>; engine?: "postgres" | "pglite" };
const g = globalThis as unknown as { __threadline?: Holder };
const holder: Holder = (g.__threadline ??= {});

export const dataDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.THREADLINE_DATA_DIR ?? ".data");
const migrationsFolder = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

/** Open (and migrate) a PostgreSQL database by URL. */
export async function openPostgres(url: string): Promise<DB> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: url, max: 5 });
  // Every checkout sets both the role and the organization, so nothing carries over from
  // whichever scope used that pooled connection before.
  const scopedPool = (role: string, orgId: string) => {
    const facade = Object.create(pool) as typeof pool;
    const connect = async () => {
      const client = await pool.connect();
      try {
        await client.query(SET_SCOPE, [role, orgId, false]);
      } catch (e) {
        client.release(e as Error);
        throw e;
      }
      return client;
    };
    const query = async (config: unknown, values?: unknown) => {
      const client = await connect();
      try {
        return await client.query(config as never, values as never);
      } finally {
        client.release();
      }
    };
    return Object.assign(facade, { connect, query });
  };
  const db = drizzle({ client: scopedPool("none", ""), schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  install({ engine: "postgres", close: () => pool.end(), makeTenant: (orgId) => drizzle({ client: scopedPool(APP_ROLE, orgId), schema }) as unknown as DB });
  await assertTenantRole();
  return db as unknown as DB;
}

async function open(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) return openPostgres(url);
  const dir = path.join(dataDir(), "pglite");
  fs.mkdirSync(dir, { recursive: true });
  return openPglite(new PGlite(dir));
}

/**
 * Embedded engine. It has one connection and runs each query and each transaction under an
 * exclusive lock, so a tenant handle wraps every statement in a transaction that sets the
 * role and organization locally: nothing can interleave, and nothing outlives the statement.
 */
export async function openPglite(client: PGlite, runMigrations = true): Promise<DB> {
  const db = drizzlePglite({ client, schema });
  if (runMigrations) await migratePglite(db, { migrationsFolder: migrationsFolder() });
  const scoped = (orgId: string) => {
    type Tx = Parameters<Parameters<PGlite["transaction"]>[0]>[0];
    const enter = (tx: Tx) => tx.query(SET_SCOPE, [APP_ROLE, orgId, true]);
    const facade = Object.create(client) as PGlite;
    return Object.assign(facade, {
      query: ((q: string, params?: unknown[], opts?: object) => client.transaction(async (tx) => { await enter(tx); return tx.query(q, params, opts); })) as PGlite["query"],
      transaction: (<T>(cb: (tx: Tx) => Promise<T>) => client.transaction(async (tx) => { await enter(tx); return cb(tx); })) as PGlite["transaction"],
    });
  };
  install({ engine: "pglite", close: () => client.close(), makeTenant: (orgId) => drizzlePglite({ client: scoped(orgId), schema }) });
  await assertTenantRole();
  return db;
}

function install(h: Required<Pick<Holder, "engine" | "close" | "makeTenant">>) {
  Object.assign(holder, h, { tenants: new Map<string, DB>() });
}

/** Fail at start-up, loudly, if the runtime role cannot be assumed. Never run unconfined. */
async function assertTenantRole() {
  try {
    await holder.makeTenant!("__startup_check__").execute(sql`select 1`);
  } catch (e) {
    throw new Error(`threadline: cannot switch to the database role "${APP_ROLE}" (${(e as Error).message}). See docs/DEPLOYMENT.md, "Database".`);
  }
}

/** Is organization isolation in force? Reported on Data & Privacy and by /api/health. */
export async function rowLevelSecurityStatus() {
  const db = await getDb("system");
  const res = await db.execute(sql`select c.relname as name, c.relrowsecurity as enabled from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1`);
  const rows = (res as unknown as { rows: { name: string; enabled: boolean }[] }).rows;
  const unprotected = rows.filter((r) => !r.enabled).map((r) => r.name);
  return { engine: holder.engine ?? "unknown", tables: rows.length, unprotected, enforced: unprotected.length === 0 && rows.length > 0 };
}

export function getDb(scope: DbScope): Promise<DB> {
  const system = (holder.db ??= open());
  if (scope === "system") return system;
  const orgId = scope.orgId;
  if (!orgId) return Promise.reject(new Error("threadline: an organization-scoped database handle needs an organization id"));
  return system.then(() => {
    let db = holder.tenants!.get(orgId);
    if (!db) holder.tenants!.set(orgId, (db = holder.makeTenant!(orgId)));
    return db;
  });
}

/** Tests (and scripts) can install a specific database instance. */
export function setDb(db: DB) {
  holder.db = Promise.resolve(db);
}

export async function closeDb() {
  if (holder.close) await holder.close();
  holder.db = undefined;
  holder.close = undefined;
  holder.makeTenant = undefined;
  holder.tenants = undefined;
}

export const usingPostgres = () => !!process.env.DATABASE_URL;

/** Development only: drop everything and re-run migrations. Refuses to run in production. */
export async function resetDatabase() {
  if (process.env.NODE_ENV === "production") throw new Error("resetDatabase is disabled in production");
  if (usingPostgres()) {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
    await c.end();
  } else {
    fs.rmSync(path.join(dataDir(), "pglite"), { recursive: true, force: true });
  }
  fs.rmSync(path.join(dataDir(), "blobs"), { recursive: true, force: true });
}

export { schema };
