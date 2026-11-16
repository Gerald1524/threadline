import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, visibleScope, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { caseEvents, cases, events, reviewItems, sourceRecords, units } from "../db/schema";
import { stableId } from "../util/core";
import { recordInAppEvent } from "./inapp";

export const CASE_STATUSES = ["open", "investigating", "awaiting_response", "resolved", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Explicit state machine. Anything not listed is rejected. */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  open: ["investigating", "awaiting_response", "resolved"],
  investigating: ["awaiting_response", "resolved", "open"],
  awaiting_response: ["investigating", "resolved", "open"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

export class WorkflowError extends Error {}

export async function listCases(ctx: AccessContext) {
  assertCan(ctx, "cases.read");
  const db = await getDb();
  const rows = await db.select({ c: cases, unit: units.label, n: sql<number>`(select count(*)::int from case_events ce where ce.case_id = ${cases.id} and ce.link_status = 'confirmed')`, last: sql<string | null>`(select max(e.occurred_at) from case_events ce join events e on e.id = ce.event_id where ce.case_id = ${cases.id} and ce.link_status = 'confirmed')` })
    .from(cases).leftJoin(units, eq(units.id, cases.unitId)).where(visibleScope(ctx, cases)).orderBy(desc(cases.openedAt));
  return rows.map((r) => ({ ...r.c, unitLabel: r.unit, eventCount: r.n, lastActivityAt: r.last ? new Date(r.last) : null }));
}

export async function getCase(ctx: AccessContext, caseId: string) {
  assertCan(ctx, "cases.read");
  const db = await getDb();
  const [c] = await db.select().from(cases).where(and(eq(cases.id, caseId), visibleScope(ctx, cases)));
  return c ?? null;
}

export async function setCaseStatus(ctx: AccessContext, input: { caseId: string; status: CaseStatus; note?: string; at?: Date }) {
  assertCan(ctx, "cases.manage");
  const { caseId, status, note } = z.object({ caseId: z.string(), status: z.enum(CASE_STATUSES), note: z.string().max(1000).optional() }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(cases).where(and(eq(cases.id, caseId), scopeOf(ctx, cases)));
    if (!c) throw new WorkflowError("Case not found");
    if (c.status === status) return c;
    if (!CASE_TRANSITIONS[c.status as CaseStatus].includes(status)) throw new WorkflowError(`A case cannot move from "${c.status}" to "${status}".`);
    const at = input.at ?? new Date();
    await tx.update(cases).set({ status, closedAt: status === "closed" || status === "resolved" ? at : null }).where(eq(cases.id, caseId));
    await recordInAppEvent(tx, ctx, { type: "status_change", category: c.category, summary: `Case status: ${c.status} → ${status}`, text: `${ctx.userName} changed the case status from ${c.status} to ${status}.${note ? ` Note: ${note}` : ""}`, unitId: c.unitId, caseId, at });
    await audit(tx, ctx, "case.status_changed", "case", caseId, { from: c.status, to: status }, at);
    return { ...c, status };
  });
}

/** Human decision on whether an event belongs to a case (confirm, reject, or add manually). */
export async function setEventLink(ctx: AccessContext, input: { caseId: string; eventId: string; decision: "confirmed" | "rejected"; at?: Date }) {
  assertCan(ctx, "cases.manage");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(cases).where(and(eq(cases.id, input.caseId), scopeOf(ctx, cases)));
    const [e] = await tx.select().from(events).where(and(eq(events.id, input.eventId), scopeOf(ctx, events)));
    if (!c || !e) throw new WorkflowError("Case or event not found");
    const at = input.at ?? new Date();
    await tx.insert(caseEvents).values({ id: stableId("ce", c.id, e.id), orgId: ctx.orgId, propertyId: ctx.propertyId, caseId: c.id, eventId: e.id, linkStatus: input.decision, method: "human", confidence: 1, rationale: `Decided by ${ctx.userName}.`, decidedBy: ctx.userId, decidedAt: at })
      .onConflictDoUpdate({ target: [caseEvents.caseId, caseEvents.eventId], set: { linkStatus: input.decision, method: "human", decidedBy: ctx.userId, decidedAt: at } });
    await tx.update(reviewItems).set({ status: "resolved", resolution: input.decision === "confirmed" ? "Link confirmed" : "Link rejected", resolvedBy: ctx.userId, resolvedAt: at })
      .where(and(eq(reviewItems.caseId, c.id), eq(reviewItems.eventId, e.id), eq(reviewItems.type, "tentative_link"), eq(reviewItems.status, "open")));
    await audit(tx, ctx, `case.link_${input.decision}`, "case", c.id, { eventId: e.id }, at);
  });
}

/** Corrections are appended; the original entry is never edited or hidden. */
export async function addCorrection(ctx: AccessContext, input: { eventId: string; text: string }) {
  assertCan(ctx, "activity.write");
  const { eventId, text } = z.object({ eventId: z.string(), text: z.string().trim().min(5).max(2000) }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(events).where(and(eq(events.id, eventId), visibleScope(ctx, events)));
    if (!e) throw new WorkflowError("Event not found");
    const links = await tx.select().from(caseEvents).where(and(eq(caseEvents.eventId, eventId), eq(caseEvents.linkStatus, "confirmed")));
    const res = await recordInAppEvent(tx, ctx, { type: "correction", category: e.category, summary: `Correction to an entry of ${e.occurredAt.toISOString().slice(0, 10)}`, text, unitId: e.unitId, caseId: links[0]?.caseId, correctsEventId: eventId, visibility: e.visibility as "staff", classification: "note" });
    await audit(tx, ctx, "event.correction_added", "event", eventId, { correctionEventId: res.eventId });
    return res;
  });
}

export async function getSourceRecord(ctx: AccessContext, id: string) {
  assertCan(ctx, "sources.read");
  const db = await getDb();
  const [r] = await db.select().from(sourceRecords).where(and(eq(sourceRecords.id, id), visibleScope(ctx, sourceRecords)));
  return r ?? null;
}
