import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { ask } from "@/lib/engine/ask";
import { decideApproval, listApprovals, requestApproval } from "@/lib/services/approvals";
import { addCorrection, setCaseStatus, setEventLink } from "@/lib/services/cases";
import { acknowledgeHandoff, draftHandoffItems, listHandoffs, publishHandoff } from "@/lib/services/handoffs";
import { confirmIntake, previewIntake } from "@/lib/services/intake";
import { draftMessage, sendMessage, updateDraft } from "@/lib/services/messages";
import { listReviewItems, resolveReview } from "@/lib/services/review";
import { listWorkOrders, updateWorkOrder } from "@/lib/services/workorders";
import { NOW, as, useSeededDb } from "./helpers/db";

const KEY_Q = "What's happening with Carter's replacement key?";

describe("workflows: approvals, work orders, messages, handoffs, intake", () => {
  useSeededDb();
  const priya = as("u_priya"), michael = as("u_michael"), luis = as("u_luis"), sam = as("u_sam"), angela = as("u_angela"), marcus = as("u_marcus");
  const caseByNumber = async (n: string) => (await (await getDb("system")).select().from(t.cases).where(and(eq(t.cases.propertyId, "prop_riverside"), eq(t.cases.number, n))))[0];

  it("key request: update request -> maintenance ETA -> the answer and the case reflect the new state", async () => {
    const before = (await ask(michael, { question: KEY_Q }, { now: NOW })).answer;
    const action = before.actions.find((a) => a.kind === "draft_message" && a.messageKind === "maintenance_update_request");
    expect(action).toBeTruthy();
    if (action?.kind !== "draft_message") throw new Error("unreachable");

    // Two clicks on "Request maintenance update" yield one draft; two clicks on Send yield one message.
    const d1 = await draftMessage(michael, { kind: "maintenance_update_request", workOrderId: action.workOrderId, caseId: action.caseId, idempotencyKey: "click-0001-abc" });
    const d2 = await draftMessage(michael, { kind: "maintenance_update_request", workOrderId: action.workOrderId, caseId: action.caseId, idempotencyKey: "click-0001-abc" });
    expect(d2.id).toBe(d1.id);
    expect(d1.status).toBe("draft");
    expect(d1.body).toContain("there is no ETA on file");
    expect(d1.body).toContain("followed up 2 times");
    expect(d1.toLabel).toBe("Luis Ortega");
    await updateDraft(michael, { id: d1.id, subject: d1.subject, body: `${d1.body}\n\nHe leaves Tuesday at 6am.` });
    expect((await sendMessage(michael, { id: d1.id })).sent).toBe(true);
    expect((await sendMessage(michael, { id: d1.id })).sent).toBe(false);
    const db = await getDb("system");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.events).where(and(eq(t.events.type, "maintenance_update_request"), eq(t.events.workOrderId, action.workOrderId!)));
    expect(n).toBe(1);

    // Maintenance responds by updating the work order.
    const eta = new Date("2026-11-16T20:00:00Z");
    await updateWorkOrder(luis, { id: action.workOrderId!, status: "in_progress", eta, note: "Key blank on hand, cutting this afternoon." });
    const after = (await ask(michael, { question: KEY_Q }, { now: NOW })).answer;
    expect(after.headline).toContain("in progress, ETA Mon, Nov 16, 2026, 3:00 PM");
    expect(after.claims.some((c) => c.text.includes("An update was requested from maintenance on"))).toBe(true);
    expect(after.claims.some((c) => c.text.includes("No update request to maintenance"))).toBe(false);
    expect(after.verification.withheld).toBe(0);

    // A resident-facing update is drafted for human review; front desk cannot send it, a manager can.
    const r = await draftMessage(michael, { kind: "resident_update", caseId: action.caseId, idempotencyKey: "click-0002-abc" });
    expect(r.body).toContain("expected completion of Mon, Nov 16, 2026, 3:00 PM");
    await expect(sendMessage(michael, { id: r.id })).rejects.toThrow(/Not permitted/);
    expect((await sendMessage(priya, { id: r.id })).sent).toBe(true);
    const final = (await ask(priya, { question: KEY_Q }, { now: new Date() })).answer;
    expect(final.facts.find((f) => f.key === "unanswered")?.n).toBe(0);
  });

  it("an approval is decided once, by someone other than the requester, and creates exactly one work order", async () => {
    const { approval } = await requestApproval(michael, { type: "key_replacement", title: "Replacement key — 3D", detail: "Lost key.", unitId: "unit_riverside_3d", idempotencyKey: "apr-test-0001" });
    const again = await requestApproval(michael, { type: "key_replacement", title: "Replacement key — 3D", detail: "Lost key.", unitId: "unit_riverside_3d", idempotencyKey: "apr-test-0001" });
    expect(again).toMatchObject({ created: false });
    const before = (await listWorkOrders(priya)).length;
    const first = await decideApproval(priya, { id: approval.id, decision: "approved", note: "ID checked." });
    expect(first.workOrder?.number).toMatch(/^WO-\d+$/);
    const second = await decideApproval(priya, { id: approval.id, decision: "approved", note: "ID checked." });
    expect(second.changed).toBe(false);
    expect((await listWorkOrders(priya)).length).toBe(before + 1);
    await expect(decideApproval(priya, { id: approval.id, decision: "denied", note: "changed my mind" })).rejects.toThrow(/already approved/);
  });

  it("the requester cannot approve their own request, and a denial needs a reason", async () => {
    const { approval } = await requestApproval(priya, { type: "policy_exception", title: "Late move-out — 2F", detail: "Requested by the resident.", idempotencyKey: "apr-test-0002" });
    await expect(decideApproval(priya, { id: approval.id, decision: "approved" })).rejects.toThrow(/cannot approve it/);
    await expect(decideApproval(marcus, { id: approval.id, decision: "denied" })).rejects.toThrow(/needs a short reason/);
    expect((await decideApproval(marcus, { id: approval.id, decision: "denied", note: "Outside policy hours." })).approval.status).toBe("denied");
  });

  it("mirror request: policy answer -> review request -> manager decision is on the record", async () => {
    const { answer } = await ask(sam, { question: "Ms. Feldman in 9A wants maintenance to hang a 60 lb mirror and to borrow a drill. What's the policy?" }, { now: NOW });
    const action = answer.actions.find((a) => a.kind === "request_approval");
    if (action?.kind !== "request_approval") throw new Error("expected a request_approval action");
    expect(action.approvalType).toBe("installation_review");
    const { approval } = await requestApproval(sam, { type: action.approvalType, title: action.title, detail: action.detail, caseId: action.caseId, unitId: action.unitId, policyVersionId: action.policyVersionId, idempotencyKey: "mirror-0001-xyz" });
    expect(approval.status).toBe("pending");
    await decideApproval(priya, { id: approval.id, decision: "denied", note: "Over 40 lbs: resident to use a licensed and insured contractor. Hand tools may be loaned." });
    const row = (await listApprovals(sam)).find((a) => a.id === approval.id)!;
    expect(row).toMatchObject({ status: "denied", deciderName: "Priya Raman" });
    const status = (await ask(sam, { question: "What's the status of the mirror request for 9A?" }, { now: new Date() })).answer;
    expect(status.claims.some((c) => c.text.includes("was denied by Priya Raman") && c.text.includes("licensed and insured contractor"))).toBe(true);
  });

  it("state machines reject invalid transitions", async () => {
    const c = await caseByNumber("C-1010");
    await expect(setCaseStatus(priya, { caseId: c.id, status: "closed" })).rejects.toThrow(/cannot move from "open" to "closed"/);
    const [wo] = (await listWorkOrders(priya)).filter((w) => w.status === "completed");
    await expect(updateWorkOrder(luis, { id: wo.id, status: "in_progress" })).rejects.toThrow(/cannot move from "Completed"/);
  });

  it("a human can confirm or reject a tentative link, and only confirmed links are counted", async () => {
    const stairwell = (await listReviewItems(priya)).find((r) => r.type === "tentative_link" && r.detail.includes("floor 11/12"))!;
    const q = "What do we know about the smoke complaints about 12B?";
    const before = (await ask(priya, { question: q }, { now: NOW })).answer;
    expect(before.facts.find((f) => f.key === "tentative")?.n).toBe(2);
    await resolveReview(priya, { id: stairwell.id, decision: "reject", note: "Stairwell B is used by several floors." });
    const after = (await ask(priya, { question: q }, { now: NOW })).answer;
    expect(after.facts.find((f) => f.key === "tentative")?.n).toBe(1);
    expect(after.sources.some((s) => s.externalId === "FD-1030-04")).toBe(false);
    // Manual association of the unidentified-caller noise report with the 6E case.
    const db = await getDb("system");
    const [ev] = await db.select({ e: t.events }).from(t.events).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.events.sourceRecordId)).where(eq(t.sourceRecords.externalId, "TC-0049"));
    await setEventLink(priya, { caseId: (await caseByNumber("C-1006")).id, eventId: ev.e.id, decision: "confirmed" });
    const noise = (await ask(priya, { question: "What do we know about the noise complaints from 5E about 6E?" }, { now: NOW })).answer;
    expect(noise.facts.find((f) => f.key === "complaints")?.n).toBe(6);
  });

  it("corrections are appended and the original entry is untouched", async () => {
    const db = await getDb("system");
    const [orig] = await db.select({ e: t.events, sr: t.sourceRecords }).from(t.events).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.events.sourceRecordId)).where(eq(t.sourceRecords.externalId, "FD-1019-12"));
    const res = await addCorrection(michael, { eventId: orig.e.id, text: "Correction: Frank went up at 6:55pm, not 6:50pm, per his own note." });
    const [after] = await db.select().from(t.sourceRecords).where(eq(t.sourceRecords.id, orig.sr.id));
    expect(after.rawText).toBe(orig.sr.rawText);
    const [corr] = await db.select().from(t.events).where(eq(t.events.id, res.eventId));
    expect(corr).toMatchObject({ type: "correction", correctsEventId: orig.e.id, recorderUserId: "u_michael" });
    const { answer } = await ask(priya, { question: "What do we know about the smoke complaints about 12B?" }, { now: new Date() });
    expect(answer.timeline.some((i) => i.type === "correction" && i.correctionOf === orig.e.id)).toBe(true);
  });

  it("temp-staff handoff: publish, acknowledge once, and see who has acknowledged", async () => {
    const items = await draftHandoffItems(sam, NOW);
    expect(items.some((i) => i.text.includes("C-1009"))).toBe(true);
    expect(items.every((i) => !/attorney|Third request/.test(i.text))).toBe(true); // nothing from management-only mail
    const h = await publishHandoff(sam, { shiftLabel: "Day → Evening", note: "Test", items: items.slice(0, 3) });
    expect((await acknowledgeHandoff(michael, h.id)).first).toBe(true);
    expect((await acknowledgeHandoff(michael, h.id)).first).toBe(false);
    const listed = (await listHandoffs(angela)).find((x) => x.id === h.id)!;
    expect(listed.fromEmployment).toBe("temp");
    expect(listed.acks.map((a) => a.name)).toEqual(["Michael Torres"]);
  });

  it("dictated intake: preview, confirm once, then find it by asking", async () => {
    const input = { text: "Mrs. Liu from 13B called at the desk, says there is a loud banging noise coming from 14B above her. Asked Carlos to check.", unit: "13B", inputMode: "voice" as const, idempotencyKey: "intake-0001-xyz" };
    const preview = await previewIntake(angela, input);
    expect(preview.events[0]).toMatchObject({ type: "complaint_report", category: "noise", unit: "14B", reporterUnit: "13B", reporterName: "Grace Liu" });
    expect(preview.events[0].claims.map((c) => c.classification)).toEqual(["allegation", "documented_action"]);
    const a = await confirmIntake(angela, input);
    const b = await confirmIntake(angela, input);
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, sourceRecordId: a.sourceRecordId });
    const { answer } = await ask(angela, { question: "any noise complaints about fourteen bee?", inputMode: "voice" }, { now: new Date() });
    expect(answer.caseRef?.title).toBe("Noise — 14B (reported by 13B)");
    expect(answer.claims[0].text).toContain("Grace Liu (13B), recorded by Angela Brooks");
  });

  it("every workflow step above is in the audit trail and the hash chain is intact", async () => {
    const db = await getDb("system");
    const actions = new Set((await db.select({ a: t.auditLog.action }).from(t.auditLog).where(eq(t.auditLog.orgId, "org_northbridge"))).map((r) => r.a));
    for (const a of ["message.drafted", "message.sent", "work_order.updated", "work_order.created", "approval.requested", "approval.approved", "approval.denied", "review.resolved", "case.link_confirmed", "event.correction_added", "handoff.published", "handoff.acknowledged", "intake.recorded", "ask.answered", "ingest.succeeded", "legal_hold.placed"]) expect(actions.has(a), a).toBe(true);
    expect(await verifyAuditChain(db, "org_northbridge")).toMatchObject({ brokenAt: null });
    const metas = await db.select({ m: t.auditLog.meta }).from(t.auditLog).where(eq(t.auditLog.orgId, "org_northbridge"));
    expect(JSON.stringify(metas)).not.toMatch(/Whitfield|cigarette|He leaves Tuesday/); // identifiers and state only, never content
  });
});
