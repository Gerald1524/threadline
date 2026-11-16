import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, visibleScope, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { approvals, cases, handoffAcks, handoffs, users, workOrders, type HandoffItem } from "../db/schema";
import { buildCaseEvidence } from "../engine/evidence";
import { newId } from "../util/core";
import { fmtDate, fmtDateTime } from "../util/time";

/** Suggested handoff items, built from what is open right now and visible to the author. */
export async function draftHandoffItems(ctx: AccessContext, now = new Date()): Promise<HandoffItem[]> {
  assertCan(ctx, "handoffs.write");
  const db = await getDb();
  const tz = ctx.timezone;
  const items: HandoffItem[] = [];
  const open = await db.select().from(cases).where(and(visibleScope(ctx, cases), inArray(cases.status, ["open", "investigating", "awaiting_response"])));
  for (const c of open) {
    const ev = await buildCaseEvidence(ctx, c.id, now);
    if (!ev) continue;
    const last = ev.confirmed.at(-1);
    const recent = last && now.getTime() - new Date(last.occurredAt).getTime() < 5 * 86400_000;
    const actionable = ev.openItems.filter((o) => ["work_order", "approval", "reply_needed"].includes(o.kind));
    if (!recent && !actionable.length) continue;
    items.push({ kind: "case", refId: c.id, text: `${c.number} ${c.title}: ${actionable.length ? actionable.slice(0, 2).map((o) => o.text).join(" ") : `last activity ${last ? fmtDate(last.occurredAt, tz) : "unknown"}.`}` });
  }
  const pend = await db.select().from(approvals).where(and(scopeOf(ctx, approvals), eq(approvals.status, "pending")));
  for (const a of pend) items.push({ kind: "approval", refId: a.id, text: `Waiting on manager decision: "${a.title}" (requested ${fmtDate(a.requestedAt, tz)}).` });
  const wos = await db.select().from(workOrders).where(and(scopeOf(ctx, workOrders), inArray(workOrders.status, ["open", "assigned", "in_progress"])));
  for (const w of wos.filter((w) => !w.eta && !w.caseId)) items.push({ kind: "work_order", refId: w.id, text: `${w.number} ${w.title} — no ETA on file.` });
  return items.slice(0, 14);
}

export async function publishHandoff(ctx: AccessContext, input: { shiftLabel: string; note?: string; items: HandoffItem[]; at?: Date }) {
  assertCan(ctx, "handoffs.write");
  const v = z.object({ shiftLabel: z.string().trim().min(2).max(80), note: z.string().trim().max(2000).optional(), items: z.array(z.object({ kind: z.enum(["case", "work_order", "approval", "note"]), refId: z.string().optional(), text: z.string().trim().min(2).max(600) })).max(30) }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const at = input.at ?? new Date();
    const [row] = await tx.insert(handoffs).values({ id: newId("hand"), orgId: ctx.orgId, propertyId: ctx.propertyId, fromUserId: ctx.userId, shiftLabel: v.shiftLabel, note: v.note ?? "", items: v.items, createdAt: at }).returning();
    await audit(tx, ctx, "handoff.published", "handoff", row.id, { items: v.items.length }, at);
    return row;
  });
}

/** The incoming employee confirms they have read the handoff. One acknowledgement per person. */
export async function acknowledgeHandoff(ctx: AccessContext, handoffId: string, at = new Date()) {
  assertCan(ctx, "handoffs.read");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(handoffs).where(and(eq(handoffs.id, handoffId), scopeOf(ctx, handoffs)));
    if (!h) throw new Error("Handoff not found");
    const res = await tx.insert(handoffAcks).values({ id: newId("ack"), orgId: ctx.orgId, propertyId: ctx.propertyId, handoffId, userId: ctx.userId, acknowledgedAt: at }).onConflictDoNothing().returning();
    if (res.length) await audit(tx, ctx, "handoff.acknowledged", "handoff", handoffId, {}, at);
    return { acknowledged: true, first: res.length > 0 };
  });
}

export async function listHandoffs(ctx: AccessContext, limit = 12) {
  assertCan(ctx, "handoffs.read");
  const db = await getDb();
  const rows = await db.select({ h: handoffs, from: users.fullName, title: users.jobTitle, employment: users.employmentType }).from(handoffs).leftJoin(users, eq(users.id, handoffs.fromUserId)).where(scopeOf(ctx, handoffs)).orderBy(desc(handoffs.createdAt)).limit(limit);
  const acks = rows.length ? await db.select({ a: handoffAcks, name: users.fullName }).from(handoffAcks).leftJoin(users, eq(users.id, handoffAcks.userId)).where(inArray(handoffAcks.handoffId, rows.map((r) => r.h.id))) : [];
  return rows.map((r) => ({ ...r.h, fromName: r.from, fromTitle: r.title, fromEmployment: r.employment, when: fmtDateTime(r.h.createdAt, ctx.timezone), acks: acks.filter((a) => a.a.handoffId === r.h.id).map((a) => ({ userId: a.a.userId, name: a.name, at: a.a.acknowledgedAt })) }));
}
