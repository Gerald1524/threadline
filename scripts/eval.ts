/** `npm run eval` — scores Threadline against the independent answer key and writes docs/eval-results.json. */
import "./_env";
import fs from "node:fs";
import { closeDb, usingPostgres } from "../src/lib/db/client";
import { setNarratorForTests } from "../src/lib/engine/ask";
import { runEvals } from "../src/lib/evals/run";

// Evaluations fix "now" and use the deterministic composer so results are repeatable.
// Run against a freshly seeded database (`npm run reset`): workflow actions change the expected state.
const NOW = new Date("2026-11-16T15:00:00Z");
setNarratorForTests(null);
const { results, summary } = await runEvals(NOW);
for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.id.padEnd(40)} ${String(r.latencyMs).padStart(4)} ms  [${r.tags.join(", ")}]`);
  for (const f of r.failures) console.log(`        ✗ ${f}`);
}
console.log("\n" + JSON.stringify(summary, null, 2));
fs.writeFileSync("docs/eval-results.json", JSON.stringify({ ranAt: new Date().toISOString(), evaluatedAsOf: NOW.toISOString(), engine: usingPostgres() ? "PostgreSQL" : "PGlite", mode: "deterministic composer (no model key)", summary, results }, null, 2) + "\n");
await closeDb();
process.exit(summary.passed === summary.cases ? 0 : 1);
