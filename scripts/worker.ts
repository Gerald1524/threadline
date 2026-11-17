/**
 * `npm run worker` — background work outside the web process:
 *   - processes queued imports (start the app with THREADLINE_JOB_MODE=worker so uploads are
 *     queued instead of run inline) and recovers imports interrupted by a stopped process;
 *   - syncs connector sources on a schedule (THREADLINE_SYNC_INTERVAL_MINUTES, default 15;
 *     0 turns scheduled syncs off).
 * Several workers may run at once: each job and each due source is claimed atomically.
 */
import "./_env";
import { closeDb } from "../src/lib/db/client";
import { syncDueSources } from "../src/lib/connectors";
import { requeueStalledJobs, runQueuedJobs } from "../src/lib/ingest/pipeline";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.THREADLINE_WORKER_INTERVAL_MS ?? 3000);
const syncEveryMs = Number(process.env.THREADLINE_SYNC_INTERVAL_MINUTES ?? 15) * 60_000;
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });

console.log(`worker started (${once ? "single pass" : `polling every ${intervalMs} ms`}; ${syncEveryMs > 0 ? `connector syncs every ${syncEveryMs / 60_000} min` : "scheduled syncs off"})`);
while (!stopping) {
  try {
    const stalled = await requeueStalledJobs();
    if (stalled.length) console.log(`recovered ${stalled.length} interrupted job(s)`);
    const n = await runQueuedJobs();
    if (n) console.log(`processed ${n} job(s)`);
    if (syncEveryMs > 0) {
      for (const r of await syncDueSources({ intervalMs: syncEveryMs })) {
        console.log(r.error ? `sync ${r.sourceId} failed: ${r.error}` : `sync ${r.sourceId}: ${r.upToDate ? "up to date" : `${r.files} new file(s)`}`);
      }
    }
  } catch (e) {
    console.error("worker pass failed:", (e as Error).message);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, intervalMs));
}
await closeDb();
console.log("worker stopped");
