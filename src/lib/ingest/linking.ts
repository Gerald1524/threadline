/**
 * Case association. Deterministic rules propose links; anything uncertain or consequential
 * is stored as `suggested` and queued for a human. Only `confirmed` links count as evidence.
 */
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { caseEvents, cases, events, reviewItems, units } from "../db/schema";
import { stableId } from "../util/core";
import { CATEGORY_LABEL, COMPLAINT_CATEGORIES, isCaseCategory } from "./lexicon";
import type { Directory, EventDraft } from "./extract";

const DAY = 86400_000;
const CASE_WINDOW_DAYS = 45;
const FLOOR_WINDOW_DAYS = 21;
const CREATES_CASE = new Set(["complaint_report", "request", "follow_up"]);
const AUTO_CONFIRM = new Set(["complaint_report", "request", "follow_up", "investigation", "work_order", "response", "resident_statement"]);

type EventRow = typeof events.$inferSelect;

async function caseSpan(tx: Tx, caseId: string) {
  const [r] = await tx.select({ min: sql<string | null>`min(${events.occurredAt})`, max: sql<string | null>`max(${events.occurredAt})` })
    .from(caseEvents).innerJoin(events, eq(events.id, caseEvents.eventId)).where(and(eq(caseEvents.caseId, caseId), ne(caseEvents.linkStatus, "rejected")));
  return r?.min && r?.max ? { min: new Date(r.min), max: new Date(r.max) } : null;
}

async function insertLink(tx: Tx, ev: EventRow, caseId: string, linkStatus: "confirmed" | "suggested", method: string, confidence: number, rationale: string) {
  await tx.insert(caseEvents).values({ id: stableId("ce", caseId, ev.id), orgId: ev.orgId, propertyId: ev.propertyId, caseId, eventId: ev.id, linkStatus, method, confidence, rationale }).onConflictDoNothing();
  const [c] = await tx.select().from(cases).where(eq(cases.id, caseId));
  if (linkStatus === "confirmed" && c && ev.occurredAt < c.openedAt) await tx.update(cases).set({ openedAt: ev.occurredAt }).where(eq(cases.id, caseId));
  if (linkStatus === "suggested") {
    await tx.insert(reviewItems).values({
      id: stableId("rev", "tentative_link", caseId, ev.id), orgId: ev.orgId, propertyId: ev.propertyId, type: "tentative_link",
      title: `Possible link to ${c?.number ?? "case"}: ${c?.title ?? ""}`, detail: rationale, sourceRecordId: ev.sourceRecordId, eventId: ev.id, caseId,
    }).onConflictDoNothing();
  }
}

/** Link a newly inserted event. Returns the case id it was attached to, if any. */
export async function linkEvent(tx: Tx, dir: Directory, ev: EventRow, draft: EventDraft, opts: { injection: boolean }): Promise<string | null> {
  const untrusted = !!draft.unknownSender || opts.injection;

  // 1. Same email thread as an already-linked message.
  if (draft.threadKey) {
    const [sibling] = await tx.select({ caseId: caseEvents.caseId, status: caseEvents.linkStatus })
      .from(events).innerJoin(caseEvents, eq(caseEvents.eventId, events.id))
      .where(and(eq(events.propertyId, ev.propertyId), eq(events.threadKey, draft.threadKey), ne(events.id, ev.id), eq(caseEvents.linkStatus, "confirmed"))).limit(1);
    if (sibling) {
      await insertLink(tx, ev, sibling.caseId, untrusted ? "suggested" : "confirmed", "thread", untrusted ? 0.3 : 0.95, "Same email thread as a message already in this case.");
      return sibling.caseId;
    }
  }
  if (!isCaseCategory(draft.category)) return null;

  const candidates = await tx.select().from(cases).where(and(eq(cases.propertyId, ev.propertyId), eq(cases.category, draft.category)));
  const withinWindow = async (caseId: string, days: number) => {
    const span = await caseSpan(tx, caseId);
    if (!span) return true;
    return ev.occurredAt.getTime() >= span.min.getTime() - days * DAY && ev.occurredAt.getTime() <= span.max.getTime() + days * DAY;
  };

  // 2. Same category and same subject unit, close in time.
  for (const c of candidates) {
    const strong = !!draft.unitId && draft.unitId === c.unitId;
    const viaComplainant = !!draft.unitId && draft.unitId === c.complainantUnitId && !draft.reporterUnitId && !!c.unitId && draft.mentionedUnitIds.includes(c.unitId);
    const viaMention = !draft.unitId && draft.type === "work_order" && !!c.unitId && draft.mentionedUnitIds.includes(c.unitId);
    if (!(strong || viaComplainant || viaMention)) continue;
    if (!(await withinWindow(c.id, CASE_WINDOW_DAYS))) continue;
    if (draft.type === "note" || draft.type === "correspondence") {
      // Routine notes are only *suggested*, and only when they carry an observation or name the complainant.
      const complainant = dir.residents.find((r) => r.id === c.complainantResidentId);
      const text = draft.claims.map((x) => x.text).join(" ").toLowerCase();
      const relevant = draft.claims.some((x) => x.classification === "staff_observation") || (!!complainant && text.includes(complainant.surname));
      if (!relevant) continue;
      await insertLink(tx, ev, c.id, "suggested", "rule", 0.5, "Routine note that mentions the same unit and topic as this case. Not counted as evidence until confirmed.");
      return c.id;
    }
    const status = untrusted || !AUTO_CONFIRM.has(draft.type) || draft.confidence < 0.8 ? "suggested" : "confirmed";
    const why = untrusted
      ? "Mentions the same unit and topic, but the sender is unidentified or the text contains instruction-like content. Held for review."
      : strong ? "Same category and same subject unit, within the case's time window." : "Concerns the complainant's unit and references the subject unit of this case.";
    await insertLink(tx, ev, c.id, status, "rule", status === "confirmed" ? 0.9 : 0.3, why);
    return c.id;
  }

  // 3. No unit named, but a floor is: suggest cases on that floor.
  if (!draft.unitId && draft.floors.length && COMPLAINT_CATEGORIES.has(draft.category)) {
    for (const c of candidates) {
      if (!c.unitId) continue;
      const [u] = await tx.select().from(units).where(eq(units.id, c.unitId));
      if (!u || !draft.floors.includes(u.floor) || !(await withinWindow(c.id, FLOOR_WINDOW_DAYS))) continue;
      await insertLink(tx, ev, c.id, "suggested", "rule", 0.45, `No apartment is named. The record refers to floor ${draft.floors.join("/")} and the same topic as this case, which concerns a unit on floor ${u.floor}.`);
      return c.id;
    }
  }

  // 4. Open a new case for an identified report or request.
  if (CREATES_CASE.has(draft.type) && draft.unitId && !untrusted && draft.confidence >= 0.8) {
    const labelOf = (id?: string | null) => [...dir.units.entries()].find(([, v]) => v.id === id)?.[0];
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(cases).where(eq(cases.propertyId, ev.propertyId));
    const id = stableId("case", ev.propertyId, draft.category, draft.unitId, ev.id);
    const reportedBy = draft.reporterUnitId && draft.reporterUnitId !== draft.unitId ? ` (reported by ${labelOf(draft.reporterUnitId)})` : "";
    await tx.insert(cases).values({
      id, orgId: ev.orgId, propertyId: ev.propertyId, number: `C-${1001 + n}`, title: `${CATEGORY_LABEL[draft.category] ?? draft.category} — ${labelOf(draft.unitId)}${reportedBy}`,
      category: draft.category, unitId: draft.unitId, complainantUnitId: draft.reporterUnitId ?? null, complainantResidentId: draft.reporterResidentId ?? null, openedAt: ev.occurredAt,
    });
    await insertLink(tx, ev, id, "confirmed", "rule", 1, "First report: case opened from this record.");
    return id;
  }
  return null;
}

/** Second pass: replies that were ingested before the message they answer. */
export async function relinkThreads(tx: Tx, propertyId: string) {
  const linked = tx.select({ id: caseEvents.eventId }).from(caseEvents);
  const pending = await tx.select().from(events).where(and(eq(events.propertyId, propertyId), eq(events.status, "active"), isNotNull(events.threadKey), sql`${events.id} not in ${linked}`));
  for (const ev of pending) {
    const [sibling] = await tx.select({ caseId: caseEvents.caseId })
      .from(events).innerJoin(caseEvents, eq(caseEvents.eventId, events.id))
      .where(and(eq(events.propertyId, propertyId), eq(events.threadKey, ev.threadKey!), ne(events.id, ev.id), eq(caseEvents.linkStatus, "confirmed"))).limit(1);
    if (!sibling) continue;
    const untrusted = ev.extractionConfidence < 0.5;
    await insertLink(tx, ev, sibling.caseId, untrusted ? "suggested" : "confirmed", "thread", untrusted ? 0.3 : 0.95, "Same email thread as a message already in this case.");
  }
}

/** Two reports of the same thing from the same apartment within an hour are queued as possible duplicates. */
export async function flagDuplicates(tx: Tx, ev: EventRow) {
  // Only desk-log entries are compared: a call and a follow-up email are separate contacts, not duplicates.
  if (ev.type !== "complaint_report" || !ev.reporterUnitId || ev.channel === "email") return;
  const near = await tx.select().from(events).where(and(
    eq(events.propertyId, ev.propertyId), eq(events.type, "complaint_report"), eq(events.category, ev.category), eq(events.reporterUnitId, ev.reporterUnitId),
    eq(events.status, "active"), ne(events.id, ev.id), ne(events.sourceRecordId, ev.sourceRecordId), ne(events.channel, "email"),
    sql`abs(extract(epoch from (${events.occurredAt} - ${ev.occurredAt.toISOString()}::timestamptz))) <= 3600`,
  ));
  for (const other of near) {
    const [first, second] = other.occurredAt <= ev.occurredAt ? [other, ev] : [ev, other];
    const mins = Math.round(Math.abs(first.occurredAt.getTime() - second.occurredAt.getTime()) / 60000);
    await tx.insert(reviewItems).values({
      id: stableId("rev", "dup", first.id, second.id), orgId: ev.orgId, propertyId: ev.propertyId, type: "duplicate_candidate",
      title: "Possible duplicate report", detail: `Two entries from different logs describe a ${CATEGORY_LABEL[ev.category] ?? ev.category} report from the same apartment ${mins} minutes apart. If they describe one call, mark the later entry as a duplicate so it is not double-counted.`,
      sourceRecordId: second.sourceRecordId, eventId: second.id, relatedEventId: first.id,
    }).onConflictDoNothing();
  }
}

export async function openReviewCount(tx: Tx, propertyId: string) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(reviewItems).where(and(eq(reviewItems.propertyId, propertyId), eq(reviewItems.status, "open")));
  return n;
}
