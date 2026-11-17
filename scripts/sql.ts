/** Developer aid: run read-only SQL against the local database. `npx tsx scripts/sql.ts "select ..."` */
import "./_env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db/client";

const db = await getDb("system");
for (const s of process.argv.slice(2)) for (const r of (await db.execute(sql.raw(s))).rows) console.log(JSON.stringify(r));
await closeDb();
