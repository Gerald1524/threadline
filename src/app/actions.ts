"use server";

/**
 * Server actions: thin, authenticated entry points. Each resolves the caller's access
 * context from the session, then calls a service that enforces capabilities and scope.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { attempt, type ActionResult } from "@/lib/action-result";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, listAccessibleProperties, requireContext } from "@/lib/auth/session";
import { syncSource } from "@/lib/connectors";
import { getDb } from "@/lib/db/client";
import { users, type HandoffItem } from "@/lib/db/schema";
import { jobsRunInWorker, retryJob, runJob, submitFile } from "@/lib/ingest/pipeline";
import { beginTwoStepEnrolment, confirmTwoStepEnrolment, disableTwoStep, regenerateRecoveryCodes, verifySignInSecondFactor } from "@/lib/services/account";
import { decideApproval, requestApproval } from "@/lib/services/approvals";
import { addCorrection, setCaseStatus, setEventLink, type CaseStatus } from "@/lib/services/cases";
import { acknowledgeHandoff, publishHandoff } from "@/lib/services/handoffs";
import { confirmIntake, previewIntake, type IntakeInput } from "@/lib/services/intake";
import { discardDraft, draftMessage, sendMessage, updateDraft, type MessageKind } from "@/lib/services/messages";
import { decideLifecycle, exportOrganization, placeLegalHold, setTwoStepRequirement, proposeLifecycle, releaseLegalHold, setExcludedSensitivity, setSourceStatus, updateProviderPolicy, updateRetention } from "@/lib/services/privacy";
import { generatePacket } from "@/lib/services/reports";
import { resolveReview, type ReviewDecision } from "@/lib/services/review";
import { updateWorkOrder, type WoStatus } from "@/lib/services/workorders";
import type { AiTask } from "@/lib/ai/provider";
import { zonedToUtc } from "@/lib/util/time";

const refresh = () => revalidatePath("/", "layout");
const demoLoginEnabled = () => process.env.THREADLINE_DEMO_LOGIN !== "0";

// ---------------------------------------------------------------- session

const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const code = String(form.get("code") ?? "");
  const a = attempts.get(email);
  if (a && a.n >= 5 && a.until > Date.now()) return { error: "Too many attempts. Try again in a few minutes." };
  // Sign-in looks a person up by email before their organization is known.
  const db = await getDb("system");
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const passwordOk = !!user && user.active && verifyPassword(password, user.passwordHash);
  // The second factor is checked (and a code spent) only after the password is right.
  const ok = passwordOk && (!user.totpEnabled || !!(await verifySignInSecondFactor(user.id, code)));
  if (!ok) {
    attempts.set(email, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60_000 });
    // One message for every failure, so it does not reveal which emails exist or use two-step verification.
    return { error: "Email, password or verification code is incorrect." };
  }
  attempts.delete(email);
  const { options } = await listAccessibleProperties(user.id);
  if (!options.length) return { error: "This account has no property access." };
  await createSession(user.id, options[0].propertyId);
  redirect("/");
}

/** One-click sign-in for the synthetic accounts. Disabled with THREADLINE_DEMO_LOGIN=0. */
export async function demoLoginAction(form: FormData) {
  if (!demoLoginEnabled()) redirect("/login");
  const userId = String(form.get("userId") ?? "");
  const { user, options } = await listAccessibleProperties(userId);
  if (!user || !options.length) redirect("/login");
  // One-click sign-in never bypasses two-step verification.
  if (user.totpEnabled) redirect("/login?twostep=1");
  await createSession(user.id, options[0].propertyId);
  redirect("/");
}

// ---------------------------------------------------------------- account

const setup = { allowTwoStepSetup: true };

export async function beginTwoStepAction(): Promise<ActionResult<{ secret: string; qrSvg: string }>> {
  const ctx = await requireContext(undefined, setup);
  return attempt(async () => {
    const { secret, uri } = await beginTwoStepEnrolment(ctx);
    return { secret, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
  });
}

export async function confirmTwoStepAction(code: string) {
  const ctx = await requireContext(undefined, setup);
  const r = await attempt(() => confirmTwoStepEnrolment(ctx, code), "Two-step verification is on. You will be asked for a code at your next sign-in.");
  refresh();
  return r;
}

export async function regenerateRecoveryCodesAction(code: string) {
  const ctx = await requireContext(undefined, setup);
  const r = await attempt(() => regenerateRecoveryCodes(ctx, code), "New recovery codes created. The old ones no longer work.");
  refresh();
  return r;
}

export async function disableTwoStepAction(input: { password: string; code: string }) {
  const ctx = await requireContext(undefined, setup);
  const r = await attempt(() => disableTwoStep(ctx, input), "Two-step verification is off.");
  refresh();
  return r;
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchPropertyAction(form: FormData) {
  const ctx = await requireContext();
  const propertyId = String(form.get("propertyId") ?? "");
  const { options } = await listAccessibleProperties(ctx.userId);
  if (options.some((o) => o.propertyId === propertyId)) await createSession(ctx.userId, propertyId);
  redirect("/");
}

// ---------------------------------------------------------------- workflows

export async function decideApprovalAction(input: { id: string; decision: "approved" | "denied"; note?: string; assigneeUserId?: string | null }) {
  const ctx = await requireContext();
  const r = await attempt(() => decideApproval(ctx, input));
  refresh();
  return r.ok ? ({ ok: true, message: r.data?.workOrder ? `Recorded. Work order ${r.data.workOrder.number} created.` : "Decision recorded." } as ActionResult) : r;
}

export async function requestApprovalAction(input: { type: string; title: string; detail: string; caseId?: string; unitId?: string; policyVersionId?: string; idempotencyKey: string }) {
  const ctx = await requireContext();
  const r = await attempt(() => requestApproval(ctx, input));
  refresh();
  return r.ok ? ({ ok: true, message: r.data?.created ? "Submitted for the community manager's review." : "This request was already submitted." } as ActionResult) : r;
}

export async function updateWorkOrderAction(input: { id: string; status?: WoStatus; etaLocal?: string | null; assigneeUserId?: string | null; note?: string }) {
  const ctx = await requireContext();
  const eta = input.etaLocal === undefined ? undefined : input.etaLocal ? zonedToUtc(input.etaLocal.slice(0, 10), input.etaLocal.slice(11, 16), ctx.timezone) : null;
  const r = await attempt(() => updateWorkOrder(ctx, { id: input.id, status: input.status, eta, assigneeUserId: input.assigneeUserId, note: input.note || undefined }), "Work order updated.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function draftMessageAction(input: { kind: MessageKind; caseId?: string; workOrderId?: string; idempotencyKey: string }) {
  const ctx = await requireContext();
  return attempt(async () => {
    const m = await draftMessage(ctx, input);
    return { id: m.id, toLabel: m.toLabel, subject: m.subject, body: m.body, status: m.status, audience: m.audience };
  });
}

export async function sendMessageAction(input: { id: string; subject: string; body: string }) {
  const ctx = await requireContext();
  const r = await attempt(async () => {
    await updateDraft(ctx, input);
    return sendMessage(ctx, { id: input.id });
  });
  refresh();
  return r.ok ? ({ ok: true, message: r.data?.sent ? "Sent (simulated delivery) and added to the case record." : "This message was already sent." } as ActionResult) : r;
}

export async function discardDraftAction(id: string) {
  const ctx = await requireContext();
  return attempt(() => discardDraft(ctx, id));
}

export async function setCaseStatusAction(input: { caseId: string; status: CaseStatus; note?: string }) {
  const ctx = await requireContext();
  const r = await attempt(() => setCaseStatus(ctx, input), "Status updated.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function legalHoldAction(input: { caseId?: string; reason?: string; releaseId?: string }) {
  const ctx = await requireContext();
  const r = await attempt(async () => (input.releaseId ? releaseLegalHold(ctx, input.releaseId) : placeLegalHold(ctx, { caseId: input.caseId!, reason: input.reason ?? "" })), input.releaseId ? "Hold released." : "Legal hold placed.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function resolveReviewAction(input: { id: string; decision: ReviewDecision; note?: string }) {
  const ctx = await requireContext();
  const r = await attempt(() => resolveReview(ctx, input), "Decision recorded.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function setEventLinkAction(input: { caseId: string; eventId: string; decision: "confirmed" | "rejected" }) {
  const ctx = await requireContext();
  const r = await attempt(() => setEventLink(ctx, input), "Link updated.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function addCorrectionAction(input: { eventId: string; text: string }) {
  const ctx = await requireContext();
  const r = await attempt(() => addCorrection(ctx, input), "Correction added. The original entry is unchanged.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function publishHandoffAction(input: { shiftLabel: string; note?: string; items: HandoffItem[] }) {
  const ctx = await requireContext();
  const r = await attempt(() => publishHandoff(ctx, input), "Handoff published.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function ackHandoffAction(id: string) {
  const ctx = await requireContext();
  const r = await attempt(() => acknowledgeHandoff(ctx, id), "Acknowledged.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function previewIntakeAction(input: IntakeInput) {
  const ctx = await requireContext();
  return attempt(() => previewIntake(ctx, input));
}

export async function confirmIntakeAction(input: IntakeInput) {
  const ctx = await requireContext();
  const r = await attempt(() => confirmIntake(ctx, input));
  refresh();
  return r.ok ? ({ ok: true, message: r.data?.created ? "Entry saved to the building record." : "This entry was already saved." } as ActionResult) : r;
}

export async function generatePacketAction(input: { caseId: string; reviewNote?: string; reviewed: boolean }) {
  const ctx = await requireContext();
  const r = await attempt(async () => ({ reportId: (await generatePacket(ctx, input)).report.id }));
  refresh();
  return r;
}

// ---------------------------------------------------------------- ingestion

export async function uploadAction(_prev: ActionResult | undefined, form: FormData): Promise<ActionResult> {
  const ctx = await requireContext("ingest.run");
  const file = form.get("file");
  const sourceId = String(form.get("sourceId") ?? "");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a file to import." };
  if (file.size > 6 * 1024 * 1024) return { ok: false, error: "Files over 6 MB are not accepted in this build." };
  const r = await attempt(async () => {
    const res = await submitFile(ctx, { sourceId, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type || undefined });
    if (res.alreadySucceeded) return { text: `"${file.name}" was already imported; nothing was added.` };
    if (jobsRunInWorker()) return { text: `"${file.name}" is queued. It will show under Import history once the worker has processed it.` };
    const job = await runJob(res.jobId);
    if (job.status !== "succeeded") throw new Error(`Import failed: ${job.error}`);
    const c = job.result!;
    return { text: `Imported "${file.name}": ${c.created} new, ${c.updated} updated, ${c.unchanged} unchanged${c.excluded ? `, ${c.excluded} excluded by policy` : ""}, ${c.reviews} flagged for review.` };
  });
  refresh();
  return r.ok ? { ok: true, message: r.data?.text } : r;
}

export async function retryJobAction(id: string) {
  const ctx = await requireContext("ingest.run");
  const r = await attempt(async () => {
    const job = await retryJob(ctx, id);
    if (job.status !== "succeeded") throw new Error(`Still failing (attempt ${job.attempts}): ${job.error}`);
  }, "Import succeeded on retry.");
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function syncSourceAction(sourceId: string) {
  const ctx = await requireContext();
  const r = await attempt(() => syncSource(ctx, sourceId));
  refresh();
  return r.ok ? ({ ok: true, message: r.data?.upToDate ? "Already up to date. No new records." : `Synced: ${r.data?.jobs.map((j) => `${j.result?.created ?? 0} new record(s)`).join(", ")}.` } as ActionResult) : r;
}

// ---------------------------------------------------------------- data & privacy

export async function setSourceStatusAction(input: { sourceId: string; status: "active" | "paused" | "disconnected" }) {
  const ctx = await requireContext();
  const r = await attempt(() => setSourceStatus(ctx, input), `Source ${input.status === "active" ? "resumed" : input.status}.`);
  refresh();
  return r.ok ? ({ ok: true, message: r.message } as ActionResult) : r;
}

export async function setTwoStepRequirementAction(required: boolean) {
  const ctx = await requireContext();
  const r = await attempt(() => setTwoStepRequirement(ctx, required), required ? "Two-step verification is now required. People without it will be asked to set it up." : "Two-step verification is no longer required.");
  refresh();
  return r;
}

export async function updateRetentionAction(input: { recordClass: string; days: number | null }) {
  const ctx = await requireContext();
  const r = await attempt(() => updateRetention(ctx, input), "Retention rule saved.");
  refresh();
  return r;
}

export async function updateProviderPolicyAction(input: { task: AiTask; provider: string; allowedSensitivity: string[] }) {
  const ctx = await requireContext();
  const r = await attempt(() => updateProviderPolicy(ctx, input), "AI provider policy saved.");
  refresh();
  return r;
}

export async function setExcludedAction(classes: string[]) {
  const ctx = await requireContext();
  const r = await attempt(() => setExcludedSensitivity(ctx, classes), "Ingestion scope saved.");
  refresh();
  return r;
}

export async function proposeLifecycleAction(input: { action: "archive" | "dispose"; recordClass: string; olderThanDate: string }) {
  const ctx = await requireContext();
  const r = await attempt(() => proposeLifecycle(ctx, { action: input.action, recordClass: input.recordClass, olderThan: new Date(`${input.olderThanDate}T00:00:00Z`) }));
  refresh();
  return r.ok ? ({ ok: true, message: `Proposed: ${r.data?.matchedCount} record(s) match, ${r.data?.heldCount} under legal hold will be skipped. Nothing has changed yet.` } as ActionResult) : r;
}

export async function decideLifecycleAction(input: { id: string; decision: "execute" | "reject"; confirm?: string }) {
  const ctx = await requireContext();
  const r = await attempt(() => decideLifecycle(ctx, input));
  refresh();
  return r.ok ? ({ ok: true, message: input.decision === "reject" ? "Request rejected. Nothing changed." : "Executed. See the audit log for the counts." } as ActionResult) : r;
}

export async function exportAction() {
  const ctx = await requireContext();
  const r = await attempt(async () => ({ id: (await exportOrganization(ctx)).id }));
  refresh();
  return r;
}
