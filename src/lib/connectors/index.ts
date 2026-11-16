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
import { and, eq } from "drizzle-orm";
import { assertCan, scopeOf, type AccessContext } from "../access";
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

export async function syncSource(ctx: AccessContext, sourceId: string) {
  assertCan(ctx, "ingest.run");
  const db = await getDb();
  const [source] = await db.select().from(dataSources).where(and(eq(dataSources.id, sourceId), scopeOf(ctx, dataSources)));
  if (!source) throw new Error("Source not found");
  if (source.mode !== "mock_connector") throw new Error("Only the simulated connector can be synced in this build.");
  if (source.status !== "active") throw new Error(`Source is ${source.status}; resume it before syncing.`);
  const res = await new MockSheetsConnector().pull(source.syncCursor);
  const jobs: Awaited<ReturnType<typeof runJob>>[] = [];
  for (const f of res.files) {
    const { jobId } = await submitFile(ctx, { sourceId, filename: f.filename, bytes: f.bytes, mediaType: "text/csv" });
    jobs.push(await runJob(jobId));
  }
  await db.transaction(async (tx) => {
    await tx.update(dataSources).set({ syncCursor: res.nextCursor, lastSyncAt: new Date(), ...(jobs.every((j) => j.status === "succeeded") ? { lastSuccessAt: new Date() } : {}) }).where(eq(dataSources.id, sourceId));
    await audit(tx, ctx, "source.synced", "data_source", sourceId, { files: res.files.length, upToDate: res.upToDate });
  });
  return { files: res.files.length, upToDate: res.upToDate, jobs: jobs.map((j) => ({ id: j.id, status: j.status, result: j.result })) };
}
