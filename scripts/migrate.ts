/**
 * `npm run db:migrate` — apply database migrations and exit. The app also migrates when it
 * first connects; run this as a release step when several app instances start at once.
 */
import "./_env";
import { closeDb, getDb, rowLevelSecurityStatus, usingPostgres } from "../src/lib/db/client";

await getDb("system");
const s = await rowLevelSecurityStatus();
console.log(`database: ${usingPostgres() ? "PostgreSQL" : "embedded PGlite"}; migrations applied`);
console.log(s.enforced ? `organization isolation: enforced on ${s.tables} tables` : `organization isolation NOT enforced on: ${s.unprotected.join(", ")}`);
await closeDb();
if (!s.enforced) process.exit(1);
