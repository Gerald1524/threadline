import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb, type Tx } from "../db/client";
import { users, units, workOrders } from "../db/schema";
import { newId } from "../util/core";
import { fmtDateTime } from "../util/time";
import { WorkflowError } from "./cases";
import { recordInAppEvent } from "./inapp";

export const WO_STATUSES = ["open", "assigned", "in_progress", "on_hold", "completed", "cancelled"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const WO_TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  open: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "on_hold", "completed", "cancelled", "open"],
  in_progress: ["on_hold", "completed", "assigned"],
  on_hold: ["in_progress", "assigned", "cancelled"],
  completed: [],
  cancelled: [],
};
export const WO_STATUS_LABEL: Record<string, string> = { open: "Open", assigned: "Assigned", in_progress: "In progress", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };

async function nextNumber(tx: Tx, propertyId: string) {
  const [{ max }] = await tx.select({ max: sql<number | null>`max(nullif(regexp_replace(${workOrders.number}, '\\D', '', 'g'), '')::int)` }).from(workOrders).where(eq(workOrders.propertyId, propertyId));
  return `WO-${(max ?? 2000) + 1}`;
}

export type NewWorkOrder = { title: string; description?: string; unitId?: string | null; caseId?: string | null; approvalId?: string | null; assigneeUserId?: string | null; priority?: string; idempotencyKey: string; category?: string; at?: Date };

/** Used directly (with capability check) and by the approval workflow. Idempotent on idempotencyKey. */
export async function createWorkOrderTx(tx: Tx, ctx: AccessContext, input: NewWorkOrder) {
  const [existing] = await tx.select().from(workOrders).where(and(eq(workOrders.orgId, ctx.orgId), eq(workOrders.idempotencyKey, input.idempotencyKey)));
  if (existing) return { workOrder: existing, created: false };
  const at = input.at ?? new Date();
  const id = newId("wo");
  const number = await nextNumber(tx, ctx.propertyId);
  const [row] = await tx.insert(workOrders).values({
    id, orgId: ctx.orgId, propertyId: ctx.propertyId, number, title: input.title, description: input.description ?? "", status: input.assigneeUserId ? "assigned" : "open", priority: input.priority ?? "normal",
    unitId: input.unitId ?? null, caseId: input.caseId ?? null, approvalId: input.approvalId ?? null, assigneeUserId: input.assigneeUserId ?? null, createdBy: ctx.userId, createdAt: at, updatedAt: at, idempotencyKey: input.idempotencyKey,
  }).returning();
  let assignee = "";
  if (input.assigneeUserId) assignee = (await tx.select().from(users).where(eq(users.id, input.assigneeUserId)))[0]?.fullName ?? "";
  await recordInAppEvent(tx, ctx, { type: "work_order", category: input.category ?? "maintenance", summary: `${number} created: ${input.title}`, text: `${ctx.userName} created work order ${number} "${input.title}"${assignee ? `, assigned to ${assignee}` : ", not yet assigned"}. No ETA set.`, unitId: input.unitId, caseId: input.caseId, workOrderId: id, assigneeUserId: input.assigneeUserId ?? undefined, at });
  await audit(tx, ctx, "work_order.created", "work_order", id, { number, caseId: input.caseId ?? null, approvalId: input.approvalId ?? null }, at);
  return { workOrder: row, created: true };
}

export async function createWorkOrder(ctx: AccessContext, input: NewWorkOrder) {
  assertCan(ctx, "workorders.create");
  z.object({ title: z.string().trim().min(3).max(200), idempotencyKey: z.string().min(8) }).parse(input);
  const db = await getDb();
  return db.transaction((tx) => createWorkOrderTx(tx, ctx, input));
}

export async function updateWorkOrder(ctx: AccessContext, input: { id: string; status?: WoStatus; eta?: Date | null; assigneeUserId?: string | null; note?: string; at?: Date }) {
  assertCan(ctx, "workorders.update");
  z.object({ id: z.string(), status: z.enum(WO_STATUSES).optional(), note: z.string().max(1000).optional() }).parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [wo] = await tx.select().from(workOrders).where(and(eq(workOrders.id, input.id), scopeOf(ctx, workOrders)));
    if (!wo) throw new WorkflowError("Work order not found");
    const at = input.at ?? new Date();
    const changes: string[] = [];
    const set: Partial<typeof workOrders.$inferInsert> = { updatedAt: at };
    if (input.status && input.status !== wo.status) {
      if (!WO_TRANSITIONS[wo.status as WoStatus].includes(input.status)) throw new WorkflowError(`A work order cannot move from "${WO_STATUS_LABEL[wo.status]}" to "${WO_STATUS_LABEL[input.status]}".`);
      set.status = input.status;
      if (input.status === "completed") set.completedAt = at;
      changes.push(`status ${WO_STATUS_LABEL[wo.status]} → ${WO_STATUS_LABEL[input.status]}`);
    }
    if (input.eta !== undefined && (input.eta?.getTime() ?? null) !== (wo.eta?.getTime() ?? null)) {
      set.eta = input.eta;
      changes.push(input.eta ? `ETA set to ${fmtDateTime(input.eta, ctx.timezone)}` : "ETA cleared");
    }
    if (input.assigneeUserId !== undefined && input.assigneeUserId !== wo.assigneeUserId) {
      set.assigneeUserId = input.assigneeUserId;
      const name = input.assigneeUserId ? (await tx.select().from(users).where(and(eq(users.id, input.assigneeUserId), eq(users.orgId, ctx.orgId))))[0]?.fullName : null;
      if (input.assigneeUserId && !name) throw new WorkflowError("Assignee not found");
      changes.push(name ? `assigned to ${name}` : "unassigned");
      if (wo.status === "open" && !set.status && input.assigneeUserId) set.status = "assigned";
    }
    if (input.note) {
      set.resolutionNote = input.note;
      changes.push(`note: ${input.note}`);
    }
    if (!changes.length) return wo;
    await tx.update(workOrders).set(set).where(eq(workOrders.id, wo.id));
    await recordInAppEvent(tx, ctx, { type: "work_order_update", category: "maintenance", summary: `${wo.number} updated: ${changes[0]}`, text: `${ctx.userName} updated work order ${wo.number} (${wo.title}): ${changes.join("; ")}.`, unitId: wo.unitId, caseId: wo.caseId, workOrderId: wo.id, at, classification: "documented_action" });
    await audit(tx, ctx, "work_order.updated", "work_order", wo.id, { status: set.status ?? wo.status, etaSet: input.eta !== undefined, assigneeChanged: input.assigneeUserId !== undefined }, at);
    return { ...wo, ...set };
  });
}

export async function listWorkOrders(ctx: AccessContext) {
  assertCan(ctx, "workorders.read");
  const db = await getDb();
  const rows = await db.select({ w: workOrders, unit: units.label, assignee: users.fullName }).from(workOrders)
    .leftJoin(units, eq(units.id, workOrders.unitId)).leftJoin(users, eq(users.id, workOrders.assigneeUserId)).where(scopeOf(ctx, workOrders)).orderBy(desc(workOrders.createdAt));
  return rows.map((r) => ({ ...r.w, unitLabel: r.unit, assigneeName: r.assignee }));
}
