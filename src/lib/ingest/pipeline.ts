/**
 * Ingestion pipeline:
 *   receive -> preserve original -> extract -> normalize -> classify -> identify entities
 *   -> propose case links -> index -> flag uncertainty -> searchable
 *
 * Properties this module guarantees (and tests/ingest.test.ts checks):
 *   - idempotent: re-submitting the same file, or the same record, creates nothing new
 *   - versioned: a changed upstream record becomes a new version; the original stays intact
 *   - visible failure: a file that cannot be parsed leaves a failed, retryable job
 *   - scoped: a paused/disconnected source accepts nothing; excluded classes are not stored
 */
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { scopeOf, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb, type DB, type Tx } from "../db/client";
import { caseEvents, cases, claims, dataSources, events, ingestJobs, orgSettings, policies, policyVersions, reviewItems, shiftAssignments, shiftDefinitions, sourceRecords, workOrders } from "../db/schema";
import { putBlob, readBlobBytesUnchecked } from "../storage";
import { newId, recordHash, sha256, stableId } from "../util/core";
import { loadDirectory } from "./directory";
import { extractRecord, type Directory } from "./extract";
import { flagDuplicates, linkEvent, relinkThreads } from "./linking";
import { isCaseCategory } from "./lexicon";
import { parseFile, type ParsedRecord } from "./parsers";

export type IngestCounts = { parsed: number; created: number; updated: number; unchanged: number; excluded: number; events: number; reviews: number };
export class IngestBlocked extends Error {}

type Source = typeof dataSources.$inferSelect;
type Coverage = { userId: string; assignmentId: string; startsAt: Date; endsAt: Date }[];

async function frontDeskCoverage(db: DB, propertyId: string): Promise<Coverage> {
  const rows = await db.select({ userId: shiftAssignments.userId, assignmentId: shiftAssignments.id, startsAt: shiftAssignments.startsAt, endsAt: shiftAssignments.endsAt, scope: shiftDefinitions.roleScope })
    .from(shiftAssignments).innerJoin(shiftDefinitions, eq(shiftDefinitions.id, shiftAssignments.shiftDefinitionId)).where(eq(shiftAssignments.propertyId, propertyId));
  return rows.filter((r) => r.scope === "front_desk");
}

const WO_STATUS: Record<string, string> = { completed: "completed", "in progress": "in_progress", assigned: "assigned", "on hold": "on_hold", open: "open", cancelled: "cancelled" };

async function upsertWorkOrder(tx: Tx, dir: Directory, rec: ParsedRecord, sourceRecordId: string) {
  const j = rec.json as { number: string; unit: string; title: string; description: string; status: string; assignee: string; createdBy: string; resolution: string; createdAt: string | null; updatedAt: string | null; completedAt: string | null; eta: string | null };
  const id = stableId("wo", dir.propertyId, j.number);
  const unit = dir.units.get(j.unit.replace("-", "").toUpperCase());
  const byName = (n: string) => dir.staff.find((s) => s.fullName.toLowerCase() === n.trim().toLowerCase());
  const created = j.createdAt ? new Date(j.createdAt) : new Date();
  const values = {
    title: j.title, description: j.description, status: WO_STATUS[j.status.toLowerCase()] ?? "open", unitId: unit?.id ?? null, assigneeUserId: byName(j.assignee)?.id ?? null,
    eta: j.eta ? new Date(j.eta) : null, resolutionNote: j.resolution || null, updatedAt: j.updatedAt ? new Date(j.updatedAt) : created, completedAt: j.completedAt ? new Date(j.completedAt) : null, sourceRecordId,
  };
  await tx.insert(workOrders).values({ id, orgId: dir.orgId, propertyId: dir.propertyId, number: j.number, createdBy: byName(j.createdBy)?.id ?? "system:import", createdAt: created, idempotencyKey: `import:${dir.propertyId}:${j.number}`, ...values })
    .onConflictDoUpdate({ target: workOrders.id, set: values });
  return id;
}

async function upsertPolicy(tx: Tx, dir: Directory, rec: ParsedRecord, sourceRecordId: string) {
  const j = rec.json as { key: string; title: string; category: string; version: number; status: string; effective: string | null; approvedBy: string | null };
  const policyId = stableId("pol", dir.propertyId, j.key);
  await tx.insert(policies).values({ id: policyId, orgId: dir.orgId, propertyId: dir.propertyId, key: j.key, title: j.title, category: j.category }).onConflictDoUpdate({ target: policies.id, set: { title: j.title, category: j.category } });
  let status = ["approved", "superseded", "draft"].includes(j.status) ? j.status : "draft";
  if (status === "approved") {
    const [newer] = await tx.select().from(policyVersions).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "approved"), gt(policyVersions.version, j.version)));
    if (newer) status = "superseded";
    else await tx.update(policyVersions).set({ status: "superseded" }).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "approved"), lt(policyVersions.version, j.version)));
  }
  const values = { status, effectiveFrom: j.effective, approvedByName: j.approvedBy, body: rec.text, sourceRecordId };
  await tx.insert(policyVersions).values({ id: stableId("pv", policyId, j.version), orgId: dir.orgId, propertyId: dir.propertyId, policyId, version: j.version, ...values })
    .onConflictDoUpdate({ target: policyVersions.id, set: values });
}

/** Store parsed records and everything derived from them. One transaction per record. */
export async function ingestRecords(source: Source, records: ParsedRecord[], opts: { jobId?: string; attachmentBytes?: boolean } = {}): Promise<IngestCounts> {
  const db = await getDb();
  const counts: IngestCounts = { parsed: records.length, created: 0, updated: 0, unchanged: 0, excluded: 0, events: 0, reviews: 0 };
  const dir = await loadDirectory(db, source.propertyId);
  const coverage = await frontDeskCoverage(db, source.propertyId);
  const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, source.orgId));
  const excluded = settings?.excludedSensitivity ?? [];
  const [{ n: casesBefore }] = await db.select({ n: sql<number>`count(*)::int` }).from(cases).where(eq(cases.propertyId, source.propertyId));
  const sorted = [...records].sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));

  for (const rec of sorted) {
    await db.transaction(async (tx) => {
      const contentHash = recordHash(rec.kind, rec.text, rec.json);
      const [cur] = await tx.select().from(sourceRecords).where(and(eq(sourceRecords.orgId, source.orgId), eq(sourceRecords.sourceId, source.id), eq(sourceRecords.externalId, rec.externalId), eq(sourceRecords.isCurrent, true)));
      if (cur && cur.contentHash === contentHash) {
        counts.unchanged++;
        return;
      }
      const ext = extractRecord(rec, dir, { visibility: source.defaultVisibility as "staff" | "management" | "restricted" });
      if (excluded.includes(ext.sensitivity)) {
        counts.excluded++;
        return;
      }
      const version = cur ? cur.version + 1 : 1;
      const id = stableId("sr", source.orgId, source.id, rec.externalId, version);
      if (cur) {
        await tx.update(sourceRecords).set({ isCurrent: false }).where(eq(sourceRecords.id, cur.id));
        await tx.update(events).set({ status: "superseded" }).where(and(eq(events.sourceRecordId, cur.id), eq(events.status, "active")));
        counts.updated++;
      } else counts.created++;

      await tx.insert(sourceRecords).values({
        id, orgId: source.orgId, propertyId: source.propertyId, sourceId: source.id, kind: rec.kind, externalId: rec.externalId, locator: rec.locator, title: rec.title,
        rawText: rec.text, rawJson: rec.json, filename: rec.locator.split("#")[0], author: rec.author ?? null, contentHash, version, supersedesId: cur?.id ?? null,
        occurredAt: rec.occurredAt ?? null, recordedAt: rec.recordedAt ?? null, receivedAt: rec.receivedAt ?? null, sensitivity: ext.sensitivity, visibility: ext.visibility,
        injectionFlag: ext.injection, jobId: opts.jobId ?? null,
      });
      for (const a of rec.attachments ?? []) await putBlob(tx, { orgId: source.orgId, propertyId: source.propertyId, filename: a.filename, mediaType: a.mediaType, bytes: a.bytes, sensitivity: ext.sensitivity, sourceRecordId: id });

      let workOrderId: string | undefined;
      if (rec.kind === "work_order") workOrderId = await upsertWorkOrder(tx, dir, rec, id);
      if (rec.kind === "policy_doc") await upsertPolicy(tx, dir, rec, id);

      const eventIdByKey = new Map<string, string>();
      for (const draft of ext.events) {
        const eventId = stableId("ev", id, draft.key);
        eventIdByKey.set(draft.key, eventId);
        const duty = coverage.find((c) => c.startsAt <= draft.occurredAt && draft.occurredAt < c.endsAt);
        const [row] = await tx.insert(events).values({
          id: eventId, orgId: source.orgId, propertyId: source.propertyId, sourceRecordId: id, type: draft.type, category: draft.category, channel: draft.channel, direction: draft.direction,
          summary: draft.summary, unitId: draft.unitId ?? null, reporterUnitId: draft.reporterUnitId ?? null, reporterResidentId: draft.reporterResidentId ?? null, reporterName: draft.reporterName ?? null,
          occurredAt: draft.occurredAt, recordedAt: draft.recordedAt ?? null, receivedAt: draft.receivedAt ?? null, timezone: dir.timezone, lateEntry: draft.lateEntry,
          recorderUserId: draft.recorderUserId ?? null, onDutyUserId: duty?.userId ?? null, onDutyAssignmentId: duty?.assignmentId ?? null, investigatorUserId: draft.investigatorUserId ?? null,
          assigneeUserId: draft.assigneeUserId ?? null, threadKey: draft.threadKey ?? null, externalRef: draft.externalRef ?? null, inReplyToRef: draft.inReplyToRef ?? null, workOrderId: workOrderId ?? null,
          extractionMethod: rec.kind === "work_order" ? "structured" : "rules", extractionConfidence: draft.confidence, visibility: ext.visibility, sensitivity: ext.sensitivity, hasAttachment: draft.hasAttachment,
        }).returning();
        if (draft.claims.length) {
          await tx.insert(claims).values(draft.claims.map((c, ord) => ({ id: stableId("cl", eventId, ord), orgId: source.orgId, propertyId: source.propertyId, eventId, sourceRecordId: id, ord, classification: c.classification, outcome: c.outcome ?? null, text: c.text, observerUserId: c.observerUserId ?? null })));
        }
        const caseId = await linkEvent(tx, dir, row, draft, { injection: ext.injection });
        if (workOrderId && caseId) await tx.update(workOrders).set({ caseId }).where(eq(workOrders.id, workOrderId));
        await flagDuplicates(tx, row);
        counts.events++;

        // A human decision made on the previous version of this record carries forward.
        if (cur) {
          const oldEventId = stableId("ev", cur.id, draft.key);
          const decided = (await tx.select().from(caseEvents).where(eq(caseEvents.eventId, oldEventId))).filter((l) => l.decidedBy);
          for (const l of decided) {
            await tx.insert(caseEvents).values({ ...l, id: stableId("ce", l.caseId, eventId), eventId }).onConflictDoUpdate({ target: [caseEvents.caseId, caseEvents.eventId], set: { linkStatus: l.linkStatus, decidedBy: l.decidedBy, decidedAt: l.decidedAt, method: "human" } });
          }
        }
      }
      for (const [i, r] of ext.reviews.entries()) {
        await tx.insert(reviewItems).values({ id: stableId("rev", r.type, id, i), orgId: source.orgId, propertyId: source.propertyId, type: r.type, title: r.title, detail: r.detail, sourceRecordId: id, eventId: r.eventKey ? eventIdByKey.get(r.eventKey) : (eventIdByKey.get("a") ?? null) }).onConflictDoNothing();
        counts.reviews++;
      }
    });
  }
  await db.transaction((tx) => relinkThreads(tx, source.propertyId));
  const [{ n: casesAfter }] = await db.select({ n: sql<number>`count(*)::int` }).from(cases).where(eq(cases.propertyId, source.propertyId));
  if (casesAfter > casesBefore) await relinkUnlinked(db, dir, source.propertyId);
  return counts;
}

/**
 * When a case is opened, records that arrived earlier (and so could not be linked) are
 * re-derived from their preserved originals and offered to the linker again. This makes
 * linking independent of import order.
 */
async function relinkUnlinked(db: DB, dir: Directory, propertyId: string) {
  const sources = new Map((await db.select().from(dataSources).where(eq(dataSources.propertyId, propertyId))).map((s) => [s.id, s]));
  const pending = await db.select({ ev: events, sr: sourceRecords }).from(events).innerJoin(sourceRecords, eq(sourceRecords.id, events.sourceRecordId))
    .where(and(eq(events.propertyId, propertyId), eq(events.status, "active"), ne(sourceRecords.kind, "manual_entry"), sql`${events.id} not in (select event_id from case_events)`));
  for (const { ev, sr } of pending) {
    if (!isCaseCategory(ev.category)) continue;
    const rec: ParsedRecord = { kind: sr.kind as ParsedRecord["kind"], externalId: sr.externalId, locator: sr.locator, title: sr.title, text: sr.rawText, json: sr.rawJson, author: sr.author ?? undefined, occurredAt: sr.occurredAt ?? undefined, recordedAt: sr.recordedAt ?? undefined, receivedAt: sr.receivedAt ?? undefined };
    const ext = extractRecord(rec, dir, { visibility: (sources.get(sr.sourceId)?.defaultVisibility ?? "staff") as "staff" });
    const draft = ext.events.find((d) => stableId("ev", sr.id, d.key) === ev.id);
    if (!draft || draft.type === "complaint_report" || draft.type === "request" || draft.type === "follow_up") continue; // these would have opened their own case
    await db.transaction(async (tx) => {
      const caseId = await linkEvent(tx, dir, ev, draft, { injection: ext.injection });
      if (caseId && ev.workOrderId) await tx.update(workOrders).set({ caseId }).where(eq(workOrders.id, ev.workOrderId));
    });
  }
}

// ---------------------------------------------------------------- jobs

export async function submitFile(actor: AccessContext, input: { sourceId: string; filename: string; bytes: Uint8Array; mediaType?: string }) {
  const db = await getDb();
  const [source] = await db.select().from(dataSources).where(and(eq(dataSources.id, input.sourceId), scopeOf(actor, dataSources)));
  if (!source) throw new IngestBlocked("Unknown data source for this property.");
  if (source.status !== "active") throw new IngestBlocked(`Source "${source.name}" is ${source.status}; it does not accept new records.`);
  const fileHash = sha256(input.bytes);
  const idempotencyKey = sha256(`${source.id}:${fileHash}`);
  const [existing] = await db.select().from(ingestJobs).where(and(eq(ingestJobs.orgId, actor.orgId), eq(ingestJobs.idempotencyKey, idempotencyKey)));
  if (existing) return { jobId: existing.id, deduped: true, alreadySucceeded: existing.status === "succeeded" };
  const jobId = newId("job");
  await db.transaction(async (tx) => {
    const blob = await putBlob(tx, { orgId: actor.orgId, propertyId: actor.propertyId, filename: input.filename, mediaType: input.mediaType ?? "application/octet-stream", bytes: input.bytes, sensitivity: "resident_pi" });
    await tx.insert(ingestJobs).values({ id: jobId, orgId: actor.orgId, propertyId: actor.propertyId, sourceId: source.id, filename: input.filename, blobId: blob.id, idempotencyKey, createdBy: actor.userId });
    await audit(tx, actor, "ingest.submitted", "ingest_job", jobId, { sourceId: source.id, filename: input.filename, sha256: fileHash });
  });
  return { jobId, deduped: false, alreadySucceeded: false };
}

export async function runJob(jobId: string) {
  const db = await getDb();
  const [job] = await db.select().from(ingestJobs).where(eq(ingestJobs.id, jobId));
  if (!job) throw new Error(`Unknown job ${jobId}`);
  if (job.status === "succeeded" || job.status === "running") return job;
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, job.sourceId));
  const actor = { userId: "system:ingest", userName: "Threadline ingestion", orgId: job.orgId, propertyId: job.propertyId };
  // Claim the job atomically, so two workers (or a worker and an inline run) never process it twice.
  const [claimed] = await db.update(ingestJobs).set({ status: "running", attempts: sql`${ingestJobs.attempts} + 1`, startedAt: new Date(), error: null })
    .where(and(eq(ingestJobs.id, jobId), sql`${ingestJobs.status} in ('queued', 'failed')`)).returning({ id: ingestJobs.id });
  if (!claimed) return (await db.select().from(ingestJobs).where(eq(ingestJobs.id, jobId)))[0];
  try {
    if (source.status !== "active") throw new IngestBlocked(`Source "${source.name}" is ${source.status}.`);
    const { blobs } = await import("../db/schema");
    const [blob] = await db.select().from(blobs).where(eq(blobs.id, job.blobId!));
    const bytes = readBlobBytesUnchecked(job.orgId, blob.sha256);
    const tz = (await loadDirectory(db, job.propertyId)).timezone;
    const records = await parseFile(job.filename, bytes, tz);
    const counts = await ingestRecords(source, records, { jobId });
    const times = records.flatMap((r) => [r.recordedAt, r.occurredAt]).filter((d): d is Date => !!d).map((d) => d.getTime());
    await db.transaction(async (tx) => {
      const finished = new Date();
      await tx.update(ingestJobs).set({ status: "succeeded", finishedAt: finished, result: counts }).where(eq(ingestJobs.id, jobId));
      await tx.update(dataSources).set({
        lastSyncAt: finished, lastSuccessAt: finished, lastError: null,
        coverageFrom: times.length ? sql`least(coalesce(${dataSources.coverageFrom}, ${new Date(Math.min(...times)).toISOString()}::timestamptz), ${new Date(Math.min(...times)).toISOString()}::timestamptz)` : source.coverageFrom,
        coverageThrough: times.length ? sql`greatest(coalesce(${dataSources.coverageThrough}, ${new Date(Math.max(...times)).toISOString()}::timestamptz), ${new Date(Math.max(...times)).toISOString()}::timestamptz)` : source.coverageThrough,
      }).where(eq(dataSources.id, source.id));
      await audit(tx, actor, "ingest.succeeded", "ingest_job", jobId, { sourceId: source.id, ...counts });
    });
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await db.transaction(async (tx) => {
      await tx.update(ingestJobs).set({ status: "failed", finishedAt: new Date(), error: message }).where(eq(ingestJobs.id, jobId));
      await tx.update(dataSources).set({ lastSyncAt: new Date(), lastError: `${job.filename}: ${message}` }).where(eq(dataSources.id, job.sourceId));
      await audit(tx, actor, "ingest.failed", "ingest_job", jobId, { sourceId: job.sourceId, error: message });
    });
  }
  const [after] = await db.select().from(ingestJobs).where(eq(ingestJobs.id, jobId));
  return after;
}

/** True when imports are handed to the separate worker process instead of running in the request. */
export const jobsRunInWorker = () => process.env.THREADLINE_JOB_MODE === "worker";

/**
 * A job left "running" by a process that stopped is put back in the queue, or marked failed
 * once it has used its attempts. Either way it stays visible; nothing is silently dropped.
 */
export async function requeueStalledJobs(olderThanMs = 10 * 60_000, now = new Date()) {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const rows = await db.update(ingestJobs).set({
    status: sql`case when ${ingestJobs.attempts} >= ${ingestJobs.maxAttempts} then 'failed' else 'queued' end`,
    error: "The import was interrupted before it finished.", finishedAt: now,
  }).where(and(eq(ingestJobs.status, "running"), lt(ingestJobs.startedAt, cutoff))).returning({ id: ingestJobs.id, status: ingestJobs.status });
  return rows;
}

/** Drain queued jobs (used by the worker and by scripts). */
export async function runQueuedJobs(limit = 50) {
  const db = await getDb();
  const queued = await db.select().from(ingestJobs).where(eq(ingestJobs.status, "queued")).orderBy(ingestJobs.createdAt).limit(limit);
  for (const j of queued) await runJob(j.id);
  return queued.length;
}

export async function retryJob(ctx: AccessContext, jobId: string) {
  const db = await getDb();
  const [job] = await db.select().from(ingestJobs).where(and(eq(ingestJobs.id, jobId), scopeOf(ctx, ingestJobs)));
  if (!job) throw new Error("Job not found");
  if (job.status !== "failed") return job;
  await db.transaction(async (tx) => {
    await tx.update(ingestJobs).set({ status: "queued" }).where(eq(ingestJobs.id, jobId));
    await audit(tx, ctx, "ingest.retry_requested", "ingest_job", jobId, { attempt: job.attempts + 1 });
  });
  return runJob(jobId);
}

/** Every failed job (they stay visible until they succeed), then the most recent others. */
export async function latestJobs(ctx: AccessContext, limit = 30) {
  const db = await getDb();
  const failed = await db.select().from(ingestJobs).where(and(scopeOf(ctx, ingestJobs), eq(ingestJobs.status, "failed"))).orderBy(desc(ingestJobs.createdAt));
  const rest = await db.select().from(ingestJobs).where(and(scopeOf(ctx, ingestJobs), ne(ingestJobs.status, "failed"))).orderBy(desc(ingestJobs.createdAt)).limit(limit);
  return [...failed, ...rest];
}
