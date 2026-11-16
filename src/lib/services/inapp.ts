/**
 * Actions taken inside Threadline become records too: a preserved (hashed) source record,
 * an event on the ledger, and a confirmed link to the case they belong to. This keeps
 * imported history and in-app workflow on one timeline with one provenance model.
 */
import { and, eq } from "drizzle-orm";
import type { AccessContext } from "../access";
import type { Tx } from "../db/client";
import { caseEvents, claims, dataSources, events, sourceRecords } from "../db/schema";
import { newId, sha256, stableId } from "../util/core";

export async function inAppSource(tx: Tx, ctx: Pick<AccessContext, "orgId" | "propertyId">) {
  const [s] = await tx.select().from(dataSources).where(and(eq(dataSources.propertyId, ctx.propertyId), eq(dataSources.mode, "in_app")));
  if (!s) throw new Error("In-app source is not configured for this property");
  return s;
}

export type InAppEvent = {
  type: string;
  category: string;
  summary: string;
  text: string;
  unitId?: string | null;
  caseId?: string | null;
  workOrderId?: string | null;
  at?: Date;
  visibility?: "staff" | "management" | "restricted";
  correctsEventId?: string;
  approverUserId?: string;
  assigneeUserId?: string;
  direction?: "inbound" | "outbound" | "internal";
  classification?: "documented_action" | "staff_observation" | "statement" | "note";
};

export async function recordInAppEvent(tx: Tx, ctx: AccessContext, e: InAppEvent) {
  const source = await inAppSource(tx, ctx);
  const at = e.at ?? new Date();
  const srId = newId("sr");
  const json = { type: e.type, actor: ctx.userName, actorUserId: ctx.userId, at: at.toISOString(), caseId: e.caseId ?? null, workOrderId: e.workOrderId ?? null };
  await tx.insert(sourceRecords).values({
    id: srId, orgId: ctx.orgId, propertyId: ctx.propertyId, sourceId: source.id, kind: "manual_entry", externalId: srId, locator: `threadline://in-app/${srId}`,
    title: e.summary, rawText: e.text, rawJson: json, author: ctx.userName, contentHash: sha256(JSON.stringify({ text: e.text, json })),
    occurredAt: at, recordedAt: at, ingestedAt: at, sensitivity: "internal_ops", visibility: e.visibility ?? "staff",
  });
  const eventId = stableId("ev", srId, "a");
  await tx.insert(events).values({
    id: eventId, orgId: ctx.orgId, propertyId: ctx.propertyId, sourceRecordId: srId, type: e.type, category: e.category, channel: "app", direction: e.direction ?? "internal", summary: e.summary,
    unitId: e.unitId ?? null, occurredAt: at, recordedAt: at, ingestedAt: at, timezone: ctx.timezone, recorderUserId: ctx.userId.startsWith("system:") ? null : ctx.userId,
    approverUserId: e.approverUserId ?? null, assigneeUserId: e.assigneeUserId ?? null, workOrderId: e.workOrderId ?? null, correctsEventId: e.correctsEventId ?? null,
    extractionMethod: "structured", visibility: e.visibility ?? "staff", sensitivity: "internal_ops",
  });
  await tx.insert(claims).values({ id: stableId("cl", eventId, 0), orgId: ctx.orgId, propertyId: ctx.propertyId, eventId, sourceRecordId: srId, ord: 0, classification: e.classification ?? "documented_action", text: e.text, observerUserId: null });
  if (e.caseId) {
    await tx.insert(caseEvents).values({ id: stableId("ce", e.caseId, eventId), orgId: ctx.orgId, propertyId: ctx.propertyId, caseId: e.caseId, eventId, linkStatus: "confirmed", method: "workflow", confidence: 1, rationale: "Recorded in Threadline against this case.", decidedBy: ctx.userId, decidedAt: at });
  }
  return { eventId, sourceRecordId: srId };
}
