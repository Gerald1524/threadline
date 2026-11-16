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
import * as schema from "./schema";

export type DB = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Queryable = DB | Tx;

type Holder = { db?: Promise<DB>; close?: () => Promise<void> };
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
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  holder.close = () => pool.end();
  return db as unknown as DB;
}

async function open(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) return openPostgres(url);
  const dir = path.join(dataDir(), "pglite");
  fs.mkdirSync(dir, { recursive: true });
  return openPglite(new PGlite(dir));
}

export async function openPglite(client: PGlite, runMigrations = true): Promise<DB> {
  const db = drizzlePglite(client, { schema });
  if (runMigrations) await migratePglite(db, { migrationsFolder: migrationsFolder() });
  holder.close = () => client.close();
  return db;
}

export function getDb(): Promise<DB> {
  return (holder.db ??= open());
}

/** Tests (and scripts) can install a specific database instance. */
export function setDb(db: DB) {
  holder.db = Promise.resolve(db);
}

export async function closeDb() {
  if (holder.close) await holder.close();
  holder.db = undefined;
  holder.close = undefined;
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
