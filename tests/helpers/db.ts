/** Gives each test file its own freshly cloned, fully seeded database. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import { closeDb, openPglite, openPostgres, setDb } from "@/lib/db/client";
import { setNarratorForTests } from "@/lib/engine/ask";
import { ctxFor } from "@/lib/seed/seed";

const TEST_DIR = path.resolve(".data/test");
process.env.THREADLINE_DATA_DIR = TEST_DIR;
delete process.env.DATABASE_URL;

export const NOW = new Date("2026-11-16T15:00:00Z"); // Mon Nov 16, 2026, 10:00 AM in New York
export const as = ctxFor;

export function useSeededDb() {
  let dbName: string | null = null;
  let admin: string | null = null;
  beforeAll(async () => {
    const setup = JSON.parse(fs.readFileSync(path.join(TEST_DIR, "setup.json"), "utf8")) as { engine: string; admin?: string };
    setNarratorForTests(null);
    if (setup.engine === "postgres") {
      admin = setup.admin!;
      dbName = `threadline_test_${randomBytes(5).toString("hex")}`;
      const { Client } = await import("pg");
      const c = new Client({ connectionString: admin });
      await c.connect();
      await c.query(`create database "${dbName}" template "threadline_test_template"`);
      await c.end();
      const url = new URL(admin);
      url.pathname = `/${dbName}`;
      setDb(await openPostgres(url.toString()));
    } else {
      const { PGlite } = await import("@electric-sql/pglite");
      const client = new PGlite({ loadDataDir: new Blob([fs.readFileSync(path.join(TEST_DIR, "snapshot.tar"))]) });
      setDb(await openPglite(client, false));
    }
  });
  afterAll(async () => {
    await closeDb();
    if (dbName && admin) {
      const { Client } = await import("pg");
      const c = new Client({ connectionString: admin });
      await c.connect();
      await c.query(`drop database if exists "${dbName}" with (force)`);
      await c.end();
    }
  });
}
