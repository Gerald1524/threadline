import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { cases, reports, users } from "../db/schema";
import { composeCaseOverview } from "../engine/compose";
import { buildCaseEvidence } from "../engine/evidence";
import { verifyClaims } from "../engine/verify";
import { loadDirectory } from "../ingest/directory";
import { renderPacket, type PacketData } from "../pdf/packet";
import { putBlob, readBlob } from "../storage";
import { newId, sha256 } from "../util/core";
import { WorkflowError } from "./cases";

/** Everything the reviewer sees before confirming, and everything the PDF is built from. */
export async function preparePacket(ctx: AccessContext, caseId: string, now = new Date()): Promise<PacketData | null> {
  assertCan(ctx, "reports.generate");
  const ev = await buildCaseEvidence(ctx, caseId, now);
  if (!ev) return null;
  const db = await getDb();
  const draft = composeCaseOverview(ctx, ev);
  const dir = await loadDirectory(db, ctx.propertyId);
  const checked = await verifyClaims(ctx, draft.claims, { facts: draft.facts, timeline: draft.timeline, staffNames: dir.staff.map((s) => s.fullName), directObservation: ev.direct.length > 0 });
  const confirmed = ev.items.filter((i) => i.linkStatus === "confirmed");
  const used = new Set(ev.items.map((i) => i.sourceId));
  return {
    property: ctx.propertyName, caseNumber: ev.case.number, title: ev.case.title, status: ev.case.status, category: ev.categoryLabel,
    units: [ev.subjectLabel, ev.complainantUnit].filter((u): u is string => !!u && u !== "the subject unit"), dateRange: confirmed.length ? [confirmed[0].occurredAt, confirmed.at(-1)!.occurredAt] : null,
    headline: draft.headline, facts: draft.facts, claims: checked.filter((c) => c.verification === "verified"), timeline: ev.items, gaps: ev.gaps, conflicts: ev.conflicts, tentative: ev.tentative,
    workOrders: ev.workOrders.map((w) => ({ number: w.number, title: w.title, status: w.status, assignee: w.assigneeName, completedAt: w.completedAt?.toISOString() ?? null, note: w.resolutionNote })),
    policy: ev.policy ? { title: ev.policy.title, version: ev.policy.version, effectiveFrom: ev.policy.effectiveFrom } : null,
    sources: ev.sources.filter((s) => used.has(s.id)), attachments: ev.items.flatMap((i) => i.attachments.map((a) => ({ filename: a.filename, mediaType: a.mediaType, source: ev.sources.find((s) => s.id === i.sourceId)?.label ?? "" }))),
    generatedAt: now.toISOString(), generatedBy: ctx.userName, reviewNote: "", legalHold: !!ev.legalHold, tz: ctx.timezone, restrictedNote: ev.hiddenCount ? `${ev.hiddenCount} record(s) in this case were not visible to the person generating this packet and are not included.` : null,
  };
}

/** Human-reviewed generation: the reviewer must confirm they inspected the sources. */
export async function generatePacket(ctx: AccessContext, input: { caseId: string; reviewNote?: string; reviewed: boolean; now?: Date }) {
  assertCan(ctx, "reports.generate");
  const v = z.object({ caseId: z.string(), reviewNote: z.string().trim().max(2000).optional(), reviewed: z.boolean() }).parse(input);
  if (!v.reviewed) throw new WorkflowError("Confirm that you have reviewed the timeline and sources before generating the packet.");
  const data = await preparePacket(ctx, v.caseId, input.now);
  if (!data) throw new WorkflowError("Case not found");
  data.reviewNote = v.reviewNote ?? "";
  const pdf = await renderPacket(data);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const id = newId("rep");
    const blob = await putBlob(tx, { orgId: ctx.orgId, propertyId: ctx.propertyId, filename: `${data.caseNumber}-case-packet-${data.generatedAt.slice(0, 10)}-${id.slice(-5)}.pdf`, mediaType: "application/pdf", bytes: pdf, sensitivity: "confidential_case" });
    const snapshot = { headline: data.headline, facts: data.facts, claims: data.claims, sourceIds: data.sources.map((s) => ({ id: s.id, label: s.label, contentHash: s.contentHash })), gaps: data.gaps, conflicts: data.conflicts };
    const [row] = await tx.insert(reports).values({ id, orgId: ctx.orgId, propertyId: ctx.propertyId, caseId: v.caseId, title: `${data.caseNumber} case packet`, generatedBy: ctx.userId, reviewNote: data.reviewNote, generatedAt: new Date(data.generatedAt), snapshot, sourceCount: data.sources.length, pdfBlobId: blob.id, pdfSha256: sha256(pdf) }).returning();
    await audit(tx, ctx, "report.generated", "report", id, { caseId: v.caseId, sources: data.sources.length, sha256: row.pdfSha256 });
    return { report: row, bytes: pdf };
  });
}

export async function listReports(ctx: AccessContext) {
  assertCan(ctx, "reports.read");
  const db = await getDb();
  const rows = await db.select({ r: reports, number: cases.number, caseTitle: cases.title, by: users.fullName }).from(reports).leftJoin(cases, eq(cases.id, reports.caseId)).leftJoin(users, eq(users.id, reports.generatedBy)).where(scopeOf(ctx, reports)).orderBy(desc(reports.generatedAt));
  return rows.map((x) => ({ ...x.r, caseNumber: x.number, caseTitle: x.caseTitle, generatedByName: x.by }));
}

export async function getReportPdf(ctx: AccessContext, reportId: string) {
  assertCan(ctx, "reports.read");
  const db = await getDb();
  const [r] = await db.select().from(reports).where(and(eq(reports.id, reportId), scopeOf(ctx, reports)));
  if (!r?.pdfBlobId) return null;
  const blob = await readBlob(db, ctx, r.pdfBlobId);
  if (!blob) return null;
  await db.transaction((tx) => audit(tx, ctx, "report.downloaded", "report", r.id, {}));
  return { report: r, bytes: blob.bytes, filename: blob.meta.filename };
}
