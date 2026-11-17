import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { approvals, cases, residents, units, users } from "../db/schema";
import { newId } from "../util/core";
import { WorkflowError } from "./cases";
import { recordInAppEvent } from "./inapp";
import { createWorkOrderTx } from "./workorders";

export const APPROVAL_TYPES: Record<string, { label: string; category: string; createsWorkOrder?: string }> = {
  key_replacement: { label: "Replacement key", category: "key_access", createsWorkOrder: "Cut replacement apartment key" },
  installation_review: { label: "Installation / tool policy review", category: "installation_tools" },
  policy_exception: { label: "Policy exception", category: "general" },
  move_exception: { label: "Move-in / move-out exception", category: "move" },
  contractor_access: { label: "Contractor access", category: "contractor" },
  amenity_booking: { label: "Amenity booking", category: "amenity" },
  bike_storage: { label: "Bike storage", category: "bike" },
  other: { label: "Other request", category: "general" },
};

const RequestSchema = z.object({
  type: z.string().refine((t) => t in APPROVAL_TYPES, "Unknown approval type"),
  title: z.string().trim().min(3).max(200),
  detail: z.string().trim().min(3).max(4000),
  caseId: z.string().nullish(), unitId: z.string().nullish(), residentId: z.string().nullish(), policyVersionId: z.string().nullish(),
  neededBy: z.date().nullish(), idempotencyKey: z.string().min(8),
});

export async function requestApproval(ctx: AccessContext, input: z.input<typeof RequestSchema> & { at?: Date }) {
  assertCan(ctx, "approvals.request");
  const v = RequestSchema.parse(input);
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.idempotencyKey, v.idempotencyKey)));
    if (existing) return { approval: existing, created: false };
    if (v.caseId && !(await tx.select().from(cases).where(and(eq(cases.id, v.caseId), scopeOf(ctx, cases)))).length) throw new WorkflowError("Case not found");
    const at = input.at ?? new Date();
    const id = newId("apr");
    const [row] = await tx.insert(approvals).values({ id, orgId: ctx.orgId, propertyId: ctx.propertyId, type: v.type, title: v.title, detail: v.detail, caseId: v.caseId ?? null, unitId: v.unitId ?? null, residentId: v.residentId ?? null, policyVersionId: v.policyVersionId ?? null, neededBy: v.neededBy ?? null, requestedBy: ctx.userId, requestedAt: at, idempotencyKey: v.idempotencyKey }).returning();
    await recordInAppEvent(tx, ctx, { type: "approval_request", category: APPROVAL_TYPES[v.type].category, summary: `Approval requested: ${v.title}`, text: `${ctx.userName} submitted "${v.title}" for manager approval. ${v.detail}`, unitId: v.unitId, caseId: v.caseId, at });
    await audit(tx, ctx, "approval.requested", "approval", id, { type: v.type, caseId: v.caseId ?? null }, at);
    return { approval: row, created: true };
  });
}

/**
 * A human with authority records the decision. The decision is final for this request
 * (a second click, or a second approver, changes nothing) and an approved key request
 * creates exactly one work order.
 */
export async function decideApproval(ctx: AccessContext, input: { id: string; decision: "approved" | "denied"; note?: string; assigneeUserId?: string | null; at?: Date }) {
  assertCan(ctx, "approvals.decide");
  const v = z.object({ id: z.string(), decision: z.enum(["approved", "denied"]), note: z.string().trim().max(2000).optional() }).parse(input);
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(approvals).where(and(eq(approvals.id, v.id), scopeOf(ctx, approvals)));
    if (!a) throw new WorkflowError("Approval not found");
    if (a.status !== "pending") {
      if (a.status === v.decision) return { approval: a, changed: false, workOrder: null };
      throw new WorkflowError(`This request was already ${a.status}. A recorded decision is not overwritten; submit a new request to revisit it.`);
    }
    if (a.requestedBy === ctx.userId && ctx.role !== "regional_admin") throw new WorkflowError("The person who submitted a request cannot approve it.");
    if (v.decision === "denied" && !v.note) throw new WorkflowError("A denial needs a short reason for the record.");
    const at = input.at ?? new Date();
    const [row] = await tx.update(approvals).set({ status: v.decision, decidedBy: ctx.userId, decidedAt: at, decisionNote: v.note ?? null }).where(and(eq(approvals.id, a.id), eq(approvals.status, "pending"))).returning();
    if (!row) throw new WorkflowError("This request was decided by someone else a moment ago.");
    const meta = APPROVAL_TYPES[a.type] ?? APPROVAL_TYPES.other;
    await recordInAppEvent(tx, ctx, { type: "approval_decision", category: meta.category, summary: `${meta.label} ${v.decision} by ${ctx.userName}`, text: `${ctx.userName} ${v.decision} "${a.title}".${v.note ? ` Decision note: ${v.note}` : ""}`, unitId: a.unitId, caseId: a.caseId, approverUserId: ctx.userId, at });
    await audit(tx, ctx, `approval.${v.decision}`, "approval", a.id, { type: a.type, caseId: a.caseId }, at);
    let workOrder = null;
    if (v.decision === "approved" && meta.createsWorkOrder) {
      const [unit] = a.unitId ? await tx.select().from(units).where(eq(units.id, a.unitId)) : [];
      workOrder = (await createWorkOrderTx(tx, ctx, { title: `${meta.createsWorkOrder}${unit ? ` — ${unit.label}` : ""}`, description: `Created from approved request "${a.title}".`, unitId: a.unitId, caseId: a.caseId, approvalId: a.id, assigneeUserId: input.assigneeUserId ?? null, idempotencyKey: `approval:${a.id}`, category: meta.category, at: new Date(at.getTime() + 60_000) })).workOrder;
    }
    return { approval: row, changed: true, workOrder };
  });
}

export async function listApprovals(ctx: AccessContext) {
  assertCan(ctx, "approvals.read");
  const db = await getDb(ctx);
  const rows = await db.select({ a: approvals, unit: units.label, resident: residents.fullName, requester: users.fullName }).from(approvals)
    .leftJoin(units, eq(units.id, approvals.unitId)).leftJoin(residents, eq(residents.id, approvals.residentId)).leftJoin(users, eq(users.id, approvals.requestedBy))
    .where(scopeOf(ctx, approvals)).orderBy(desc(approvals.requestedAt));
  const deciders = new Map((await db.select().from(users).where(eq(users.orgId, ctx.orgId))).map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r.a, unitLabel: r.unit, residentName: r.resident, requesterName: r.requester, deciderName: r.a.decidedBy ? (deciders.get(r.a.decidedBy) ?? null) : null }));
}
