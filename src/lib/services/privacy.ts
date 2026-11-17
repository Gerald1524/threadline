/**
 * Organization data governance: source scoping, AI provider policy, retention, legal holds,
 * approved archival/disposal, and export. The customer organization's administrators hold
 * these controls; every change is audited.
 */
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { assertCan, scopeOf, type AccessContext } from "../access";
import { audit, verifyAuditChain } from "../audit";
import { PROVIDER_CATALOG, keyConfigured, type AiTask } from "../ai/provider";
import { getDb, type Queryable } from "../db/client";
import * as t from "../db/schema";
import { SENSITIVITY_ORDER } from "../ingest/lexicon";
import { deleteBlobFile, putBlob } from "../storage";
import { canonicalJson, newId, sha256 } from "../util/core";
import { WorkflowError } from "./cases";

const orgScope = (ctx: AccessContext, col: AnyPgColumn) => eq(col, ctx.orgId);

export async function getPrivacyOverview(ctx: AccessContext) {
  assertCan(ctx, "privacy.view");
  const db = await getDb();
  const [settings] = await db.select().from(t.orgSettings).where(eq(t.orgSettings.orgId, ctx.orgId));
  const sources = await db.select().from(t.dataSources).where(scopeOf(ctx, t.dataSources)).orderBy(t.dataSources.createdAt, t.dataSources.name);
  const counts = await db.select({ sourceId: t.sourceRecords.sourceId, n: sql<number>`count(*)::int` }).from(t.sourceRecords).where(and(scopeOf(ctx, t.sourceRecords), eq(t.sourceRecords.isCurrent, true))).groupBy(t.sourceRecords.sourceId);
  const failed = await db.select().from(t.ingestJobs).where(and(scopeOf(ctx, t.ingestJobs), eq(t.ingestJobs.status, "failed")));
  const byClass = await db.select({ c: t.sourceRecords.sensitivity, lifecycle: t.sourceRecords.lifecycle, n: sql<number>`count(*)::int` }).from(t.sourceRecords).where(orgScope(ctx, t.sourceRecords.orgId)).groupBy(t.sourceRecords.sensitivity, t.sourceRecords.lifecycle);
  const holds = await db.select({ h: t.legalHolds, number: t.cases.number, title: t.cases.title, by: t.users.fullName }).from(t.legalHolds).innerJoin(t.cases, eq(t.cases.id, t.legalHolds.caseId)).leftJoin(t.users, eq(t.users.id, t.legalHolds.placedBy)).where(orgScope(ctx, t.legalHolds.orgId)).orderBy(desc(t.legalHolds.placedAt));
  const lifecycle = await db.select().from(t.lifecycleRequests).where(orgScope(ctx, t.lifecycleRequests.orgId)).orderBy(desc(t.lifecycleRequests.requestedAt)).limit(10);
  const exportsList = await db.select().from(t.exportsTable).where(orgScope(ctx, t.exportsTable.orgId)).orderBy(desc(t.exportsTable.createdAt)).limit(5);
  const providerLog = await db.select({ provider: t.providerRequests.provider, task: t.providerRequests.task, status: t.providerRequests.status, n: sql<number>`count(*)::int`, last: sql<string>`max(${t.providerRequests.at})` }).from(t.providerRequests).where(orgScope(ctx, t.providerRequests.orgId)).groupBy(t.providerRequests.provider, t.providerRequests.task, t.providerRequests.status);
  const chain = await verifyAuditChain(db, ctx.orgId);
  return {
    settings, chain, holds, lifecycle, exports: exportsList, providerLog, classCounts: byClass,
    sources: sources.map((s) => ({ ...s, records: counts.find((c) => c.sourceId === s.id)?.n ?? 0, failedJobs: failed.filter((j) => j.sourceId === s.id) })),
    providers: (Object.keys(PROVIDER_CATALOG) as AiTask[]).map((task) => ({ task, selected: settings?.providerPolicy[task]?.provider ?? "none", allowedSensitivity: settings?.providerPolicy[task]?.allowedSensitivity ?? [], options: PROVIDER_CATALOG[task].map((o) => ({ ...o, configured: keyConfigured(o.envKey) })) })),
  };
}

export async function setSourceStatus(ctx: AccessContext, input: { sourceId: string; status: "active" | "paused" | "disconnected" }) {
  assertCan(ctx, "privacy.admin");
  const v = z.object({ sourceId: z.string(), status: z.enum(["active", "paused", "disconnected"]) }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(t.dataSources).where(and(eq(t.dataSources.id, v.sourceId), scopeOf(ctx, t.dataSources)));
    if (!s) throw new WorkflowError("Source not found");
    if (s.mode === "planned_connector") throw new WorkflowError("This connector is not available in this build. It requires an authorized connection and security review.");
    if (s.status === v.status) return s;
    await tx.update(t.dataSources).set({ status: v.status }).where(eq(t.dataSources.id, s.id));
    // Disconnecting stops future intake only. Records already ingested stay under retention and hold rules.
    await audit(tx, ctx, "source.status_changed", "data_source", s.id, { from: s.status, to: v.status });
    return { ...s, status: v.status };
  });
}

export async function updateRetention(ctx: AccessContext, input: { recordClass: string; days: number | null }) {
  assertCan(ctx, "privacy.admin");
  const v = z.object({ recordClass: z.enum(SENSITIVITY_ORDER), days: z.number().int().min(30).max(36500).nullable() }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(t.orgSettings).where(eq(t.orgSettings.orgId, ctx.orgId));
    const retention = { ...s.retention, [v.recordClass]: { days: v.days } };
    await tx.update(t.orgSettings).set({ retention, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(t.orgSettings.orgId, ctx.orgId));
    await audit(tx, ctx, "retention.updated", "org_settings", ctx.orgId, { recordClass: v.recordClass, from: s.retention[v.recordClass]?.days ?? null, to: v.days });
  });
}

export async function updateProviderPolicy(ctx: AccessContext, input: { task: AiTask; provider: string; allowedSensitivity: string[] }) {
  assertCan(ctx, "privacy.admin");
  const v = z.object({ task: z.enum(["reasoning", "classification", "transcription", "speech", "embeddings"]), provider: z.string(), allowedSensitivity: z.array(z.enum(SENSITIVITY_ORDER)) }).parse(input);
  if (!PROVIDER_CATALOG[v.task].some((p) => p.id === v.provider)) throw new WorkflowError("That provider is not on the shortlist for this task.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(t.orgSettings).where(eq(t.orgSettings.orgId, ctx.orgId));
    const providerPolicy = { ...s.providerPolicy, [v.task]: { provider: v.provider, allowedSensitivity: v.allowedSensitivity } };
    await tx.update(t.orgSettings).set({ providerPolicy, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(t.orgSettings.orgId, ctx.orgId));
    await audit(tx, ctx, "provider_policy.updated", "org_settings", ctx.orgId, { task: v.task, from: s.providerPolicy[v.task]?.provider ?? null, to: v.provider, allowedSensitivity: v.allowedSensitivity });
  });
}

export async function setExcludedSensitivity(ctx: AccessContext, classes: string[]) {
  assertCan(ctx, "privacy.admin");
  const v = z.array(z.enum(SENSITIVITY_ORDER)).parse(classes);
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.update(t.orgSettings).set({ excludedSensitivity: v, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(t.orgSettings.orgId, ctx.orgId));
    await audit(tx, ctx, "ingestion_scope.updated", "org_settings", ctx.orgId, { excluded: v });
  });
}

// ---------------------------------------------------------------- legal holds

export async function placeLegalHold(ctx: AccessContext, input: { caseId: string; reason: string; at?: Date }) {
  assertCan(ctx, "cases.manage");
  const v = z.object({ caseId: z.string(), reason: z.string().trim().min(5).max(1000) }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(t.cases).where(and(eq(t.cases.id, v.caseId), scopeOf(ctx, t.cases)));
    if (!c) throw new WorkflowError("Case not found");
    const [existing] = await tx.select().from(t.legalHolds).where(and(eq(t.legalHolds.caseId, c.id), isNull(t.legalHolds.releasedAt)));
    if (existing) return existing;
    const at = input.at ?? new Date();
    const [row] = await tx.insert(t.legalHolds).values({ id: newId("hold"), orgId: ctx.orgId, propertyId: ctx.propertyId, caseId: c.id, reason: v.reason, placedBy: ctx.userId, placedAt: at }).returning();
    await audit(tx, ctx, "legal_hold.placed", "case", c.id, { holdId: row.id }, at);
    return row;
  });
}

export async function releaseLegalHold(ctx: AccessContext, holdId: string) {
  assertCan(ctx, "privacy.admin");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [h] = await tx.update(t.legalHolds).set({ releasedBy: ctx.userId, releasedAt: new Date() }).where(and(eq(t.legalHolds.id, holdId), eq(t.legalHolds.orgId, ctx.orgId), isNull(t.legalHolds.releasedAt))).returning();
    if (h) await audit(tx, ctx, "legal_hold.released", "case", h.caseId, { holdId });
    return h ?? null;
  });
}

/** Source records preserved by an active legal hold (linked, by any non-rejected link, to a held case). */
async function heldRecordIds(tx: Queryable, orgId: string): Promise<Set<string>> {
  const rows = await tx.select({ id: t.events.sourceRecordId }).from(t.legalHolds).innerJoin(t.caseEvents, eq(t.caseEvents.caseId, t.legalHolds.caseId)).innerJoin(t.events, eq(t.events.id, t.caseEvents.eventId))
    .where(and(eq(t.legalHolds.orgId, orgId), isNull(t.legalHolds.releasedAt), sql`${t.caseEvents.linkStatus} <> 'rejected'`));
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------- retention: proposed, then explicitly approved

const matchLifecycle = (orgId: string, recordClass: string, olderThan: Date) =>
  and(eq(t.sourceRecords.orgId, orgId), eq(t.sourceRecords.sensitivity, recordClass), eq(t.sourceRecords.lifecycle, "active"), lt(sql`coalesce(${t.sourceRecords.occurredAt}, ${t.sourceRecords.ingestedAt})`, olderThan));

/**
 * Retention review: for each class with a retention period, how many active records are now
 * older than it, and how many of those a legal hold protects. This only reports. Archival or
 * disposal still has to be proposed and then explicitly approved.
 */
export async function retentionReview(ctx: AccessContext, now = new Date()) {
  assertCan(ctx, "privacy.view");
  const db = await getDb();
  const [settings] = await db.select().from(t.orgSettings).where(eq(t.orgSettings.orgId, ctx.orgId));
  const held = await heldRecordIds(db, ctx.orgId);
  const out: { recordClass: string; days: number; cutoff: Date; eligible: number; held: number }[] = [];
  for (const recordClass of SENSITIVITY_ORDER) {
    const days = settings?.retention[recordClass]?.days;
    if (!days) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const matched = await db.select({ id: t.sourceRecords.id }).from(t.sourceRecords).where(matchLifecycle(ctx.orgId, recordClass, cutoff));
    out.push({ recordClass, days, cutoff, eligible: matched.length, held: matched.filter((m) => held.has(m.id)).length });
  }
  return out;
}

export async function proposeLifecycle(ctx: AccessContext, input: { action: "archive" | "dispose"; recordClass: string; olderThan: Date }) {
  assertCan(ctx, "privacy.admin");
  const v = z.object({ action: z.enum(["archive", "dispose"]), recordClass: z.enum(SENSITIVITY_ORDER), olderThan: z.date() }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const matched = await tx.select({ id: t.sourceRecords.id }).from(t.sourceRecords).where(matchLifecycle(ctx.orgId, v.recordClass, v.olderThan));
    const held = await heldRecordIds(tx, ctx.orgId);
    const heldCount = matched.filter((m) => held.has(m.id)).length;
    const [row] = await tx.insert(t.lifecycleRequests).values({ id: newId("life"), orgId: ctx.orgId, action: v.action, recordClass: v.recordClass, olderThan: v.olderThan, matchedCount: matched.length, heldCount, requestedBy: ctx.userId }).returning();
    await audit(tx, ctx, "lifecycle.proposed", "lifecycle_request", row.id, { action: v.action, recordClass: v.recordClass, matched: matched.length, held: heldCount });
    return row;
  });
}

/**
 * Explicit approval executes the request. Records under legal hold are always skipped.
 * Disposal tombstones the original (identity and hash remain for the audit trail) and
 * propagates to derived text, attachments, cached answers and generated reports.
 * Backups are outside the application: see docs/PRIVACY_SECURITY.md.
 */
export async function decideLifecycle(ctx: AccessContext, input: { id: string; decision: "execute" | "reject"; confirm?: string }) {
  assertCan(ctx, "privacy.admin");
  const db = await getDb();
  const filesToDelete: { orgId: string; sha: string }[] = [];
  const result = await db.transaction(async (tx) => {
    const [req] = await tx.select().from(t.lifecycleRequests).where(and(eq(t.lifecycleRequests.id, input.id), eq(t.lifecycleRequests.orgId, ctx.orgId)));
    if (!req) throw new WorkflowError("Request not found");
    if (req.status !== "proposed") return req;
    if (input.decision === "reject") {
      await tx.update(t.lifecycleRequests).set({ status: "rejected", decidedBy: ctx.userId, decidedAt: new Date() }).where(eq(t.lifecycleRequests.id, req.id));
      await audit(tx, ctx, "lifecycle.rejected", "lifecycle_request", req.id, {});
      return { ...req, status: "rejected" };
    }
    if (input.confirm !== req.action.toUpperCase()) throw new WorkflowError(`Type ${req.action.toUpperCase()} to confirm.`);
    const matched = await tx.select({ id: t.sourceRecords.id }).from(t.sourceRecords).where(matchLifecycle(ctx.orgId, req.recordClass, req.olderThan));
    const held = await heldRecordIds(tx, ctx.orgId);
    const ids = matched.map((m) => m.id).filter((id) => !held.has(id));
    if (ids.length) {
      if (req.action === "archive") {
        await tx.update(t.sourceRecords).set({ lifecycle: "archived" }).where(inArray(t.sourceRecords.id, ids));
      } else {
        await tx.update(t.sourceRecords).set({ lifecycle: "disposed", rawText: "[disposed under an approved retention action]", rawJson: {}, title: "[disposed]", author: null }).where(inArray(t.sourceRecords.id, ids));
        await tx.delete(t.claims).where(inArray(t.claims.sourceRecordId, ids));
        await tx.update(t.events).set({ status: "retracted", summary: "[disposed]", reporterName: null }).where(inArray(t.events.sourceRecordId, ids));
        const blobs = await tx.select().from(t.blobs).where(inArray(t.blobs.sourceRecordId, ids));
        for (const b of blobs) filesToDelete.push({ orgId: b.orgId, sha: b.sha256 });
        if (blobs.length) await tx.delete(t.blobs).where(inArray(t.blobs.id, blobs.map((b) => b.id)));
        // Cached answers and generated packets that quote a disposed record are removed too.
        for (const id of ids) {
          await tx.delete(t.conversationTurns).where(and(eq(t.conversationTurns.orgId, ctx.orgId), sql`${t.conversationTurns.answer}::text like ${"%" + id + "%"}`));
          const reps = await tx.select().from(t.reports).where(and(eq(t.reports.orgId, ctx.orgId), sql`${t.reports.snapshot}::text like ${"%" + id + "%"}`));
          for (const r of reps) {
            if (r.pdfSha256) filesToDelete.push({ orgId: r.orgId, sha: r.pdfSha256 });
            if (r.pdfBlobId) await tx.delete(t.blobs).where(eq(t.blobs.id, r.pdfBlobId));
            await tx.delete(t.reports).where(eq(t.reports.id, r.id));
          }
        }
      }
    }
    await tx.update(t.lifecycleRequests).set({ status: "executed", decidedBy: ctx.userId, decidedAt: new Date(), matchedCount: matched.length, heldCount: matched.length - ids.length, affectedCount: ids.length }).where(eq(t.lifecycleRequests.id, req.id));
    await audit(tx, ctx, `lifecycle.${req.action}_executed`, "lifecycle_request", req.id, { recordClass: req.recordClass, affected: ids.length, skippedUnderHold: matched.length - ids.length });
    return { ...req, status: "executed", affectedCount: ids.length, heldCount: matched.length - ids.length };
  });
  // Remove file bytes only after the transaction commits, and only if no other row still uses them.
  for (const f of filesToDelete) {
    const [still] = await db.select({ id: t.blobs.id }).from(t.blobs).where(and(eq(t.blobs.orgId, f.orgId), eq(t.blobs.sha256, f.sha))).limit(1);
    if (!still) deleteBlobFile(f.orgId, f.sha);
  }
  return result;
}

// ---------------------------------------------------------------- export

const EXPORT_TABLES = { properties: t.properties, units: t.units, data_sources: t.dataSources, source_records: t.sourceRecords, events: t.events, claims: t.claims, cases: t.cases, case_events: t.caseEvents, review_items: t.reviewItems, work_orders: t.workOrders, approvals: t.approvals, policies: t.policies, policy_versions: t.policyVersions, messages: t.messages, handoffs: t.handoffs, reports: t.reports, legal_holds: t.legalHolds, audit_log: t.auditLog } as const;

/** Administrator-controlled export of the organization's records, with a source manifest. */
export async function exportOrganization(ctx: AccessContext) {
  assertCan(ctx, "privacy.admin");
  const db = await getDb();
  const tables: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(EXPORT_TABLES)) tables[name] = await db.select().from(table).where(eq((table as typeof t.cases).orgId, ctx.orgId));
  const sourceManifest = (tables.source_records as (typeof t.sourceRecords.$inferSelect)[]).map((r) => ({ id: r.id, sourceId: r.sourceId, externalId: r.externalId, version: r.version, contentHash: r.contentHash, lifecycle: r.lifecycle }));
  const manifest = { format: "threadline-export/1", organizationId: ctx.orgId, generatedAt: new Date().toISOString(), generatedBy: ctx.userId, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), sourceRecords: sourceManifest.length, note: "Attachments are referenced by hash in source_records/blobs; file bytes are exported separately on request." };
  const bytes = new TextEncoder().encode(canonicalJson({ manifest, sourceManifest, tables }));
  return db.transaction(async (tx) => {
    const blob = await putBlob(tx, { orgId: ctx.orgId, propertyId: ctx.propertyId, filename: `threadline-export-${manifest.generatedAt.slice(0, 10)}.json`, mediaType: "application/json", bytes, sensitivity: "confidential_case" });
    const [row] = await tx.insert(t.exportsTable).values({ id: newId("exp"), orgId: ctx.orgId, requestedBy: ctx.userId, manifest, blobId: blob.id, sha256: sha256(bytes) }).returning();
    await audit(tx, ctx, "export.created", "export", row.id, { counts: manifest.counts, sha256: row.sha256 });
    return row;
  });
}

export async function listAudit(ctx: AccessContext, limit = 80) {
  assertCan(ctx, "audit.read");
  const db = await getDb();
  return db.select().from(t.auditLog).where(and(eq(t.auditLog.orgId, ctx.orgId), sql`(${t.auditLog.propertyId} = ${ctx.propertyId} or ${t.auditLog.propertyId} is null)`)).orderBy(desc(t.auditLog.seq)).limit(limit);
}
