/**
 * Seeds one database before the suite and exposes it as a template:
 *   - TEST_DATABASE_URL set  -> a PostgreSQL template database (each test file clones it)
 *   - otherwise              -> an embedded PGlite snapshot (each test file loads it)
 * Set THREADLINE_TEST_ENGINE=pglite to force the embedded engine.
 */
import fs from "node:fs";
import path from "node:path";

export const TEST_DIR = path.resolve(".data/test");
export const TEMPLATE_DB = "threadline_test_template";

export default async function setup() {
  for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  process.env.THREADLINE_DATA_DIR = TEST_DIR;
  delete process.env.ANTHROPIC_API_KEY; // tests never call a live model
  const admin = process.env.THREADLINE_TEST_ENGINE === "pglite" ? undefined : process.env.TEST_DATABASE_URL;
  const { setDb, closeDb, openPostgres, openPglite } = await import("../../src/lib/db/client");
  const { seedAll } = await import("../../src/lib/seed/seed");
  const started = Date.now();
  if (admin) {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: admin });
    await c.connect();
    const stale = await c.query("select datname from pg_database where datname like 'threadline_test_%'");
    for (const r of stale.rows) await c.query(`drop database if exists "${r.datname}" with (force)`);
    await c.query(`create database "${TEMPLATE_DB}"`);
    await c.end();
    const url = new URL(admin);
    url.pathname = `/${TEMPLATE_DB}`;
    setDb(await openPostgres(url.toString()));
    await seedAll();
    await closeDb();
    fs.writeFileSync(path.join(TEST_DIR, "setup.json"), JSON.stringify({ engine: "postgres", admin }));
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = new PGlite();
    setDb(await openPglite(client));
    await seedAll();
    const dump = await client.dumpDataDir("none");
    fs.writeFileSync(path.join(TEST_DIR, "snapshot.tar"), Buffer.from(await dump.arrayBuffer()));
    await closeDb();
    fs.writeFileSync(path.join(TEST_DIR, "setup.json"), JSON.stringify({ engine: "pglite" }));
  }
  console.log(`[test setup] seeded ${admin ? "PostgreSQL template" : "PGlite snapshot"} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return async () => {
    if (!admin) return;
    const { Client } = await import("pg");
    const c = new Client({ connectionString: admin });
    await c.connect();
    const dbs = await c.query("select datname from pg_database where datname like 'threadline_test_%'");
    for (const r of dbs.rows) await c.query(`drop database if exists "${r.datname}" with (force)`);
    await c.end();
  };
}
