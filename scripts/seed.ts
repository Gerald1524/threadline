/** `npm run seed` seeds an empty database; `npm run reset` wipes local state first. */
import "./_env";
import { closeDb, resetDatabase, usingPostgres } from "../src/lib/db/client";
import { isSeeded, seedAll } from "../src/lib/seed/seed";

const reset = process.argv.includes("--reset");
console.log(`database: ${usingPostgres() ? "PostgreSQL (DATABASE_URL)" : "embedded PGlite"}`);
if (reset) {
  await resetDatabase();
  console.log("database and blob store reset");
}
if (await isSeeded()) {
  console.log("database already seeded — run `npm run reset` to rebuild it");
} else {
  const started = Date.now();
  const s = await seedAll({ log: (m) => console.log(" ·", m) });
  console.log(`seeded in ${((Date.now() - started) / 1000).toFixed(1)}s (${s.files} files)`);
}
await closeDb();
