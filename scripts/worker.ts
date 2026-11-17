/**
 * `npm run worker` — processes queued imports outside the web process.
 * Start the app with THREADLINE_JOB_MODE=worker so uploads are queued instead of run inline.
 * Several workers may run at once: each job is claimed atomically.
 */
import "./_env";
import { closeDb } from "../src/lib/db/client";
import { requeueStalledJobs, runQueuedJobs } from "../src/lib/ingest/pipeline";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.THREADLINE_WORKER_INTERVAL_MS ?? 3000);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });

console.log(`worker started (${once ? "single pass" : `polling every ${intervalMs} ms`})`);
while (!stopping) {
  try {
    const stalled = await requeueStalledJobs();
    if (stalled.length) console.log(`recovered ${stalled.length} interrupted job(s)`);
    const n = await runQueuedJobs();
    if (n) console.log(`processed ${n} job(s)`);
  } catch (e) {
    console.error("worker pass failed:", (e as Error).message);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, intervalMs));
}
await closeDb();
console.log("worker stopped");
