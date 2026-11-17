/**
 * Connector contract. A connector pulls new or changed files from one authorized source,
 * starting from an opaque cursor, and hands them to the ingestion pipeline. Idempotency and
 * versioning live in the pipeline, so a connector may safely re-deliver.
 *
 * Implemented:  mock_connector — replays local fixture batches to demonstrate incremental sync.
 * Planned (contracts only, see docs/INGESTION.md): Microsoft Graph delta queries,
 * Google Drive changes / Sheets, authorized property-platform exports.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { assertCan, scopeOf, systemContext, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { dataSources } from "../db/schema";
import { runJob, submitFile } from "../ingest/pipeline";

export type PullResult = { files: { filename: string; bytes: Uint8Array }[]; nextCursor: string; upToDate: boolean };
export interface Connector { pull(cursor: string | null): Promise<PullResult> }

/** Fixture-backed stand-in for a Google Sheets incremental sync. Contacts no external service. */
export class MockSheetsConnector implements Connector {
  constructor(private dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "riverside", "mock-sync")) {}
  async pull(cursor: string | null): Promise<PullResult> {
    const n = Number(cursor ?? "0");
    const file = path.join(this.dir, `batch-${n + 1}.csv`);
    if (!fs.existsSync(file)) return { files: [], nextCursor: String(n), upToDate: true };
    return { files: [{ filename: `front-desk-log.sync-${n + 1}.csv`, bytes: new Uint8Array(fs.readFileSync(file)) }], nextCursor: String(n + 1), upToDate: false };
  }
}

export const PLANNED_CONNECTORS = {
  m365: { mechanism: "Microsoft Graph delta query per mail folder / drive item", scopes: ["Mail.Read (application permission restricted to one shared mailbox by an access policy)", "Files.Read.All or Sites.Selected for one SharePoint library"], gate: "Tenant admin consent; security review" },
  google_workspace: { mechanism: "Drive changes feed with a saved page token; Sheets values read; Gmail history for a delegated shared mailbox", scopes: ["drive.file or drive.readonly on selected files", "spreadsheets.readonly", "gmail.readonly (restricted scope: Google verification and annual security assessment)"], gate: "OAuth app verification before any public rollout" },
  property_platform: { mechanism: "Vendor API where a supported one exists, otherwise scheduled authorized exports", scopes: ["Per vendor agreement"], gate: "Written authorization from the customer and the platform" },
} as const;

type Source = typeof dataSources.$inferSelect;

export async function syncSource(ctx: AccessContext, sourceId: string) {
  assertCan(ctx, "ingest.run");
  const db = await getDb(ctx);
  const [source] = await db.select().from(dataSources).where(and(eq(dataSources.id, sourceId), scopeOf(ctx, dataSources)));
  if (!source) throw new Error("Source not found");
  if (source.mode !== "mock_connector") throw new Error("Only the simulated connector can be synced in this build.");
  if (source.status !== "active") throw new Error(`Source is ${source.status}; resume it before syncing.`);
  return pullAndIngest(ctx, source);
}

/** One incremental pull: new files go through the normal pipeline; the cursor then advances. */
async function pullAndIngest(actor: AccessContext, source: Source) {
  const db = await getDb(actor);
  const res = await new MockSheetsConnector().pull(source.syncCursor);
  const jobs: Awaited<ReturnType<typeof runJob>>[] = [];
  for (const f of res.files) {
    const { jobId } = await submitFile(actor, { sourceId: source.id, filename: f.filename, bytes: f.bytes, mediaType: "text/csv" });
    jobs.push(await runJob(jobId));
  }
  await db.transaction(async (tx) => {
    await tx.update(dataSources).set({ syncCursor: res.nextCursor, lastSyncAt: new Date(), ...(jobs.every((j) => j.status === "succeeded") ? { lastSuccessAt: new Date() } : {}) }).where(eq(dataSources.id, source.id));
    await audit(tx, actor, "source.synced", "data_source", source.id, { files: res.files.length, upToDate: res.upToDate });
  });
  return { files: res.files.length, upToDate: res.upToDate, jobs: jobs.map((j) => ({ id: j.id, status: j.status, result: j.result })) };
}

/**
 * Scheduler tick, run by the worker: syncs every active connector source whose last sync is
 * older than the interval. Each due source is claimed atomically (by stamping lastSyncAt),
 * so several workers never sync the same source at once. Paused or disconnected sources are
 * never touched. A failure is recorded on the source and retried at the next interval.
 */
export async function syncDueSources(opts: { intervalMs: number; now?: Date }) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.intervalMs);
  const due = await (await getDb("system")).update(dataSources).set({ lastSyncAt: now }) // the schedule spans organizations
    .where(and(eq(dataSources.mode, "mock_connector"), eq(dataSources.status, "active"), or(isNull(dataSources.lastSyncAt), lt(dataSources.lastSyncAt, cutoff))))
    .returning();
  const results: { sourceId: string; files?: number; upToDate?: boolean; error?: string }[] = [];
  for (const source of due) {
    const actor = { ...systemContext(source.orgId, source.propertyId), userId: "system:scheduler", userName: "Threadline scheduler" };
    try {
      const r = await pullAndIngest(actor, source);
      results.push({ sourceId: source.id, files: r.files, upToDate: r.upToDate });
    } catch (e) {
      const message = (e as Error).message.slice(0, 300);
      await (await getDb(actor)).update(dataSources).set({ lastError: `Scheduled sync: ${message}` }).where(eq(dataSources.id, source.id));
      results.push({ sourceId: source.id, error: message });
    }
  }
  return results;
}
