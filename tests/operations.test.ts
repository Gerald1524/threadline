import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/lib/audit";
import { totpCode } from "@/lib/auth/password";
import { isSealed, openSecret } from "@/lib/auth/secrets";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { requeueStalledJobs, runJob, runQueuedJobs, submitFile } from "@/lib/ingest/pipeline";
import { beginTwoStepEnrolment, confirmTwoStepEnrolment, disableTwoStep, getAccount, regenerateRecoveryCodes, verifySignInSecondFactor } from "@/lib/services/account";
import { decideLifecycle, getPrivacyOverview, proposeLifecycle, retentionReview, setTwoStepRequirement, updateRetention } from "@/lib/services/privacy";
import { NOW, as, useSeededDb } from "./helpers/db";

const enc = (s: string) => new TextEncoder().encode(s);
const note = (n: number) => enc(`# Lobby notice ${n}\n\nThe lobby doors will be serviced on Friday morning, notice ${n}.\n`);

describe("operations: import worker, two-step verification, retention review", () => {
  useSeededDb();
  const marcus = as("u_marcus"), priya = as("u_priya");
  const policySource = async () => (await (await getDb("system")).select().from(t.dataSources).where(eq(t.dataSources.id, "src_policies")))[0];

  it("a queued import is processed once, even when two workers pick it up together", async () => {
    const db = await getDb("system");
    const src = await policySource();
    const { jobId } = await submitFile(marcus, { sourceId: src.id, filename: "lobby-notice-1.md", bytes: note(1) });
    expect((await db.select().from(t.ingestJobs).where(eq(t.ingestJobs.id, jobId)))[0].status).toBe("queued");
    const [a, b] = await Promise.all([runJob(jobId), runJob(jobId)]);
    expect([a.status, b.status]).toContain("succeeded");
    const [job] = await db.select().from(t.ingestJobs).where(eq(t.ingestJobs.id, jobId));
    expect(job).toMatchObject({ status: "succeeded", attempts: 1 });
    const done = await db.select().from(t.auditLog).where(and(eq(t.auditLog.entityId, jobId), eq(t.auditLog.action, "ingest.succeeded")));
    expect(done).toHaveLength(1);
  });

  it("the worker drains the queue and recovers an import that was interrupted", async () => {
    const db = await getDb("system");
    const src = await policySource();
    const q = await submitFile(marcus, { sourceId: src.id, filename: "lobby-notice-2.md", bytes: note(2) });
    const stuck = await submitFile(marcus, { sourceId: src.id, filename: "lobby-notice-3.md", bytes: note(3) });
    await db.update(t.ingestJobs).set({ status: "running", attempts: 1, startedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(t.ingestJobs.id, stuck.jobId));
    expect(await requeueStalledJobs()).toEqual([{ id: stuck.jobId, status: "queued" }]);
    expect(await runQueuedJobs()).toBe(2);
    const rows = await db.select().from(t.ingestJobs).where(eq(t.ingestJobs.sourceId, src.id));
    expect(rows.filter((r) => [q.jobId, stuck.jobId].includes(r.id)).map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
    // Out of attempts: it fails visibly instead of looping.
    await db.update(t.ingestJobs).set({ status: "running", attempts: 3, startedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(t.ingestJobs.id, stuck.jobId));
    expect(await requeueStalledJobs()).toEqual([{ id: stuck.jobId, status: "failed" }]);
    await db.update(t.ingestJobs).set({ status: "succeeded", error: null }).where(eq(t.ingestJobs.id, stuck.jobId));
  });

  it("two-step verification turns on only after a valid code; the secret is stored encrypted", async () => {
    const db = await getDb("system");
    const at = NOW.getTime();
    expect(await getAccount(priya)).toMatchObject({ twoStepEnabled: false, enrolmentPending: false, recoveryCodesLeft: 0 });
    const { secret, uri } = await beginTwoStepEnrolment(priya);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Threadline%3A.*secret=[A-Z2-7]{20}&issuer=Threadline/);
    const [stored] = await db.select().from(t.users).where(eq(t.users.id, "u_priya"));
    expect(isSealed(stored.totpSecret)).toBe(true);
    expect(stored.totpSecret).not.toContain(secret);
    expect(openSecret(stored.totpSecret!, "totp:u_priya")).toBe(secret);
    expect(() => openSecret(stored.totpSecret!, "totp:u_dana")).toThrow(); // bound to its owner
    expect(await getAccount(priya)).toMatchObject({ twoStepEnabled: false, enrolmentPending: true });
    await expect(confirmTwoStepEnrolment(priya, "000000", at)).rejects.toThrow(/does not match/);
    const { recoveryCodes } = await confirmTwoStepEnrolment(priya, totpCode(secret, at), at);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(recoveryCodes.every((c) => /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c))).toBe(true);
    expect(await getAccount(priya)).toMatchObject({ twoStepEnabled: true, recoveryCodesLeft: 10 });
    await expect(beginTwoStepEnrolment(priya)).rejects.toThrow(/already on/);
    const all = JSON.stringify(await db.select().from(t.users).where(eq(t.users.id, "u_priya")));
    for (const c of recoveryCodes) expect(all).not.toContain(c.replace(/-/g, ""));
  });

  it("a sign-in code is accepted once, and each recovery code works once", async () => {
    const db = await getDb("system");
    const [u] = await db.select().from(t.users).where(eq(t.users.id, "u_priya"));
    const secret = openSecret(u.totpSecret!, "totp:u_priya");
    const at = NOW.getTime();
    // The code used to confirm enrolment cannot be replayed at sign-in.
    expect(await verifySignInSecondFactor("u_priya", totpCode(secret, at), at)).toBeNull();
    const next = at + 30_000;
    expect(await verifySignInSecondFactor("u_priya", totpCode(secret, next), next)).toBe("authenticator");
    expect(await verifySignInSecondFactor("u_priya", totpCode(secret, next), next)).toBeNull();
    expect(await verifySignInSecondFactor("u_priya", "123456", next + 30_000)).toBeNull();

    const { recoveryCodes } = await regenerateRecoveryCodes(priya, totpCode(secret, next + 30_000), next + 30_000);
    const code = recoveryCodes[3];
    expect(await verifySignInSecondFactor("u_priya", code.toLowerCase().replace(/-/g, " "), next + 60_000)).toBe("recovery_code");
    expect(await verifySignInSecondFactor("u_priya", code, next + 60_000)).toBeNull();
    expect((await getAccount(priya)).recoveryCodesLeft).toBe(9);
    const used = await db.select().from(t.auditLog).where(and(eq(t.auditLog.entityId, "u_priya"), eq(t.auditLog.action, "account.recovery_code_used")));
    expect(used.map((a) => a.meta)).toEqual([{ remaining: 9 }]);
    expect(JSON.stringify(used)).not.toContain(code);
  });

  it("an organization can require two-step verification; the admin must have it first", async () => {
    const db = await getDb("system");
    await expect(setTwoStepRequirement(priya, true)).rejects.toThrow(/Not permitted/);
    await expect(setTwoStepRequirement(marcus, true)).rejects.toThrow(/your own account first/);
    const { secret } = await beginTwoStepEnrolment(marcus);
    const at = NOW.getTime();
    await confirmTwoStepEnrolment(marcus, totpCode(secret, at), at);
    expect(await setTwoStepRequirement(marcus, true)).toEqual({ required: true });
    expect((await getPrivacyOverview(marcus)).twoStep).toMatchObject({ required: true, enabled: 2 });
    expect(await getAccount(priya)).toMatchObject({ requiredByOrganization: true });
    // While required, nobody can turn it off, even with the right password and code.
    const [p] = await db.select().from(t.users).where(eq(t.users.id, "u_priya"));
    const ps = openSecret(p.totpSecret!, "totp:u_priya");
    const later = at + 5 * 60_000;
    await expect(disableTwoStep(priya, { password: "threadline-demo", code: totpCode(ps, later) }, later)).rejects.toThrow(/organization requires/);
    expect(await setTwoStepRequirement(marcus, false)).toEqual({ required: false });

    // Turning it off needs the password and an unspent second factor.
    await expect(disableTwoStep(priya, { password: "wrong", code: totpCode(ps, later + 30_000) }, later + 30_000)).rejects.toThrow(/incorrect/);
    await expect(disableTwoStep(priya, { password: "threadline-demo", code: "000000" }, later + 60_000)).rejects.toThrow(/incorrect/);
    await disableTwoStep(priya, { password: "threadline-demo", code: totpCode(ps, later + 60_000) }, later + 60_000);
    expect(await getAccount(priya)).toMatchObject({ twoStepEnabled: false, enrolmentPending: false, recoveryCodesLeft: 0 });

    const actions = (await db.select().from(t.auditLog).where(eq(t.auditLog.orgId, "org_northbridge"))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["account.two_step_enrolment_started", "account.two_step_enabled", "account.recovery_codes_regenerated", "security.two_step_requirement_changed", "account.two_step_disabled"]));
    expect(await verifyAuditChain(db, "org_northbridge")).toMatchObject({ brokenAt: null });
  });

  it("retention review flags records past their period, counts legal holds, and removes nothing by itself", async () => {
    const db = await getDb("system");
    const active = async () => (await db.select().from(t.sourceRecords).where(and(eq(t.sourceRecords.orgId, "org_northbridge"), eq(t.sourceRecords.lifecycle, "active")))).length;
    const before = await active();
    expect((await retentionReview(marcus, NOW)).every((r) => r.eligible === 0)).toBe(true);
    await expect(retentionReview(as("u_michael"), NOW)).rejects.toThrow(/Not permitted/);

    await updateRetention(marcus, { recordClass: "confidential_case", days: 30 });
    const [row] = (await retentionReview(marcus, NOW)).filter((r) => r.recordClass === "confidential_case");
    expect(row.days).toBe(30);
    expect(row.eligible).toBeGreaterThan(0);
    expect(row.held).toBeGreaterThan(0);
    expect(row.held).toBeLessThanOrEqual(row.eligible);
    expect(await active()).toBe(before);

    // The flagged set is exactly what a proposal for the same cut-off would match.
    const req = await proposeLifecycle(marcus, { action: "archive", recordClass: "confidential_case", olderThan: row.cutoff });
    expect(req).toMatchObject({ matchedCount: row.eligible, heldCount: row.held, status: "proposed" });
    expect(await active()).toBe(before);
    await decideLifecycle(marcus, { id: req.id, decision: "reject" });
  });
});
