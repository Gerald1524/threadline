import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, type AccessContext, type Capability } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { approvals, caseEvents, cases, events, messages, residents, units, users, workOrders } from "../db/schema";
import { newId } from "../util/core";
import { fmtDate, fmtDateTime } from "../util/time";
import { WorkflowError } from "./cases";
import { recordInAppEvent } from "./inapp";
import { WO_STATUS_LABEL } from "./workorders";

export type MessageKind = "maintenance_update_request" | "resident_update";
const SEND_CAP: Record<string, Capability> = { maintenance: "messages.send.maintenance", resident: "messages.send.resident" };

/**
 * Prepare an editable draft from recorded facts only (dates, status, ETA, follow-up count).
 * Nothing is sent here. Idempotent on idempotencyKey so a double click yields one draft.
 */
export async function draftMessage(ctx: AccessContext, input: { kind: MessageKind; workOrderId?: string; caseId?: string; idempotencyKey: string }) {
  assertCan(ctx, "messages.draft");
  const v = z.object({ kind: z.enum(["maintenance_update_request", "resident_update"]), workOrderId: z.string().optional(), caseId: z.string().optional(), idempotencyKey: z.string().min(8) }).parse(input);
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(messages).where(and(eq(messages.orgId, ctx.orgId), eq(messages.idempotencyKey, v.idempotencyKey)));
    if (existing) return existing;
    const [wo] = v.workOrderId ? await tx.select().from(workOrders).where(and(eq(workOrders.id, v.workOrderId), scopeOf(ctx, workOrders))) : [];
    const caseId = v.caseId ?? wo?.caseId ?? undefined;
    const [c] = caseId ? await tx.select().from(cases).where(and(eq(cases.id, caseId), scopeOf(ctx, cases))) : [];
    if (!wo && !c) throw new WorkflowError("A draft needs a work order or a case to refer to.");
    const openWo = wo ?? (c ? (await tx.select().from(workOrders).where(and(eq(workOrders.caseId, c.id), scopeOf(ctx, workOrders))).orderBy(desc(workOrders.createdAt)))[0] : undefined);
    const [unit] = (openWo?.unitId ?? c?.unitId) ? await tx.select().from(units).where(eq(units.id, (openWo?.unitId ?? c?.unitId)!)) : [];
    const [approval] = c ? await tx.select().from(approvals).where(and(eq(approvals.caseId, c.id), scopeOf(ctx, approvals))).orderBy(desc(approvals.requestedAt)) : [];
    const [{ followUps }] = c
      ? await tx.select({ followUps: sql<number>`count(*)::int` }).from(caseEvents).innerJoin(events, eq(events.id, caseEvents.eventId)).where(and(eq(caseEvents.caseId, c.id), eq(caseEvents.linkStatus, "confirmed"), eq(events.type, "follow_up"), eq(events.status, "active")))
      : [{ followUps: 0 }];
    const [assignee] = openWo?.assigneeUserId ? await tx.select().from(users).where(eq(users.id, openWo.assigneeUserId)) : [];
    const [resident] = c?.complainantResidentId ? await tx.select().from(residents).where(eq(residents.id, c.complainantResidentId)) : [];
    const tz = ctx.timezone;
    const woRef = openWo ? `${openWo.number} (${openWo.title})` : "this request";

    let audience: string, toLabel: string, subject: string, body: string;
    if (v.kind === "maintenance_update_request") {
      if (!openWo) throw new WorkflowError("There is no work order to ask maintenance about.");
      audience = "maintenance";
      toLabel = assignee?.fullName ?? "Maintenance team";
      subject = `Update needed: ${openWo.number} ${openWo.title}`;
      body = [
        `Hi ${assignee ? assignee.fullName.split(" ")[0] : "team"},`,
        "",
        `Could you give the front desk an update on ${woRef}? It was opened on ${fmtDate(openWo.createdAt, tz)}, its status is "${WO_STATUS_LABEL[openWo.status]}" and ${openWo.eta ? `the ETA on file is ${fmtDateTime(openWo.eta, tz)}` : "there is no ETA on file"}.`,
        followUps ? `The resident${unit ? ` in ${unit.label}` : ""} has followed up ${followUps} time${followUps === 1 ? "" : "s"}.` : "",
        approval?.neededBy ? `The request notes it is needed by ${fmtDateTime(approval.neededBy, tz)}.` : "",
        "",
        "Please reply with an expected completion time, or update the work order directly.",
        "",
        `${ctx.userName}`,
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    } else {
      audience = "resident";
      toLabel = resident ? `${resident.fullName}${unit ? ` (${unit.label})` : ""}` : unit ? `Resident of ${unit.label}` : "Resident";
      subject = `Update on your request${unit ? ` — ${unit.label}` : ""}`;
      const decided = approval && approval.status !== "pending" ? `It was ${approval.status} on ${fmtDate(approval.decidedAt, tz)}.` : approval ? "It is waiting for the community manager's decision." : "";
      const woLine = openWo
        ? `Maintenance work order ${openWo.number} is ${WO_STATUS_LABEL[openWo.status].toLowerCase()}${openWo.eta ? `, with an expected completion of ${fmtDateTime(openWo.eta, tz)}` : "; we do not have a completion time yet and have asked maintenance for one"}.`
        : "";
      body = [`Dear ${resident ? resident.fullName : "Resident"},`, "", `This is an update on ${c ? `your request (${c.number}: ${c.title})` : "your request"}. ${decided}`.trim(), woLine, "", "We will contact you as soon as there is more to report.", "", `${ctx.userName}`, ctx.propertyName].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    }
    const [row] = await tx.insert(messages).values({ id: newId("msg"), orgId: ctx.orgId, propertyId: ctx.propertyId, kind: v.kind, audience, toLabel, subject, body, caseId: c?.id ?? null, workOrderId: openWo?.id ?? null, draftedBy: ctx.userId, draftOrigin: "template", idempotencyKey: v.idempotencyKey }).returning();
    await audit(tx, ctx, "message.drafted", "message", row.id, { kind: v.kind, caseId: c?.id ?? null, workOrderId: openWo?.id ?? null });
    return row;
  });
}

export async function updateDraft(ctx: AccessContext, input: { id: string; subject: string; body: string }) {
  assertCan(ctx, "messages.draft");
  const v = z.object({ id: z.string(), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(8000) }).parse(input);
  const db = await getDb(ctx);
  const [row] = await db.update(messages).set({ subject: v.subject, body: v.body, draftOrigin: "human" }).where(and(eq(messages.id, v.id), scopeOf(ctx, messages), eq(messages.status, "draft"))).returning();
  if (!row) throw new WorkflowError("Draft not found or already sent.");
  return row;
}

/**
 * Human-confirmed send. Delivery is simulated in this build (no email leaves the system):
 * the message is marked sent, added to the case timeline and audited. The status guard in
 * the UPDATE makes a repeated click a no-op.
 */
export async function sendMessage(ctx: AccessContext, input: { id: string; at?: Date }) {
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(messages).where(and(eq(messages.id, input.id), scopeOf(ctx, messages)));
    if (!m) throw new WorkflowError("Message not found");
    assertCan(ctx, SEND_CAP[m.audience] ?? "messages.send.resident");
    if (m.status === "sent") return { message: m, sent: false };
    const at = input.at ?? new Date();
    const [row] = await tx.update(messages).set({ status: "sent", sentBy: ctx.userId, sentAt: at }).where(and(eq(messages.id, m.id), eq(messages.status, "draft"))).returning();
    if (!row) return { message: m, sent: false };
    const [c] = m.caseId ? await tx.select().from(cases).where(eq(cases.id, m.caseId)) : [];
    await recordInAppEvent(tx, ctx, {
      type: m.audience === "maintenance" ? "maintenance_update_request" : "response", category: c?.category ?? "maintenance", direction: m.audience === "resident" ? "outbound" : "internal",
      summary: `${m.audience === "maintenance" ? "Update requested from maintenance" : "Update sent to resident"}: ${m.subject}`, text: `${ctx.userName} sent to ${m.toLabel} (simulated delivery):\n\n${m.body}`, unitId: c?.unitId, caseId: m.caseId, workOrderId: m.workOrderId, at,
    });
    await audit(tx, ctx, "message.sent", "message", m.id, { audience: m.audience, deliveryMode: m.deliveryMode, caseId: m.caseId, workOrderId: m.workOrderId }, at);
    return { message: row, sent: true };
  });
}

export async function discardDraft(ctx: AccessContext, id: string) {
  assertCan(ctx, "messages.draft");
  const db = await getDb(ctx);
  await db.update(messages).set({ status: "discarded" }).where(and(eq(messages.id, id), scopeOf(ctx, messages), eq(messages.status, "draft")));
}

export async function listMessages(ctx: AccessContext, filter: { caseId?: string; workOrderId?: string } = {}) {
  assertCan(ctx, "messages.draft");
  const db = await getDb(ctx);
  const rows = await db.select().from(messages).where(scopeOf(ctx, messages)).orderBy(desc(messages.createdAt));
  return rows.filter((m) => (!filter.caseId || m.caseId === filter.caseId) && (!filter.workOrderId || m.workOrderId === filter.workOrderId) && m.status !== "discarded");
}
