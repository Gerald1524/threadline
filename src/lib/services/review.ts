import { and, desc, eq } from "drizzle-orm";
import { assertCan, scopeOf, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { caseEvents, events, reviewItems, sourceRecords } from "../db/schema";
import { WorkflowError } from "./cases";

export async function listReviewItems(ctx: AccessContext, status: "open" | "all" = "open") {
  assertCan(ctx, "review.read");
  const db = await getDb();
  const rows = await db.select().from(reviewItems).where(status === "open" ? and(scopeOf(ctx, reviewItems), eq(reviewItems.status, "open")) : scopeOf(ctx, reviewItems)).orderBy(desc(reviewItems.createdAt));
  return rows;
}

export type ReviewDecision = "confirm" | "reject" | "acknowledge" | "restrict";

/**
 * A human decision on an uncertain or sensitive item.
 *   tentative_link      confirm -> link counts as evidence;  reject -> link discarded
 *   duplicate_candidate confirm -> later entry marked duplicate (kept, not counted);  reject -> both stand
 *   others              acknowledge -> keep as is;  restrict -> raise the record to restricted visibility
 */
export async function resolveReview(ctx: AccessContext, input: { id: string; decision: ReviewDecision; note?: string; at?: Date }) {
  assertCan(ctx, "review.resolve");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(reviewItems).where(and(eq(reviewItems.id, input.id), scopeOf(ctx, reviewItems)));
    if (!item) throw new WorkflowError("Review item not found");
    if (item.status !== "open") return item;
    const at = input.at ?? new Date();
    let resolution: string;
    if (item.type === "tentative_link" && item.caseId && item.eventId && (input.decision === "confirm" || input.decision === "reject")) {
      const linkStatus = input.decision === "confirm" ? "confirmed" : "rejected";
      await tx.update(caseEvents).set({ linkStatus, method: "human", decidedBy: ctx.userId, decidedAt: at }).where(and(eq(caseEvents.caseId, item.caseId), eq(caseEvents.eventId, item.eventId)));
      resolution = linkStatus === "confirmed" ? "Link confirmed" : "Link rejected";
    } else if (item.type === "duplicate_candidate" && item.eventId && item.relatedEventId && (input.decision === "confirm" || input.decision === "reject")) {
      if (input.decision === "confirm") await tx.update(events).set({ status: "duplicate", duplicateOfEventId: item.relatedEventId }).where(and(eq(events.id, item.eventId), scopeOf(ctx, events)));
      resolution = input.decision === "confirm" ? "Marked as duplicate of the earlier entry" : "Kept as separate reports";
    } else if (input.decision === "restrict" && item.sourceRecordId) {
      await tx.update(sourceRecords).set({ visibility: "restricted" }).where(and(eq(sourceRecords.id, item.sourceRecordId), scopeOf(ctx, sourceRecords)));
      await tx.update(events).set({ visibility: "restricted" }).where(and(eq(events.sourceRecordId, item.sourceRecordId), scopeOf(ctx, events)));
      resolution = "Restricted to managers with restricted access";
    } else if (input.decision === "acknowledge") {
      resolution = "Reviewed, no change";
    } else {
      throw new WorkflowError(`"${input.decision}" is not a valid decision for a ${item.type} item.`);
    }
    if (input.note) resolution += ` — ${input.note}`;
    await tx.update(reviewItems).set({ status: "resolved", resolution, resolvedBy: ctx.userId, resolvedAt: at }).where(eq(reviewItems.id, item.id));
    await audit(tx, ctx, "review.resolved", "review_item", item.id, { type: item.type, decision: input.decision, eventId: item.eventId, caseId: item.caseId }, at);
    return { ...item, status: "resolved", resolution };
  });
}
