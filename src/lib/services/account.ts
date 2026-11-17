/**
 * A person's own sign-in settings: two-step verification with an authenticator app
 * (time-based codes, RFC 6238) and one-time recovery codes.
 *   - The authenticator secret is stored encrypted (src/lib/auth/secrets.ts).
 *   - A code is accepted once: the last accepted 30-second step is stored.
 *   - Recovery codes are shown once and stored only as scrypt hashes; each works once.
 * Every change is audited; secrets and codes never are.
 */
import { eq } from "drizzle-orm";
import type { AccessContext } from "../access";
import { audit } from "../audit";
import { generateRecoveryCodes, generateTotpSecret, hashPassword, looksLikeRecoveryCode, matchTotpStep, normalizeRecoveryCode, verifyPassword } from "../auth/password";
import { openSecret, sealSecret } from "../auth/secrets";
import { getDb, type Tx } from "../db/client";
import { orgSettings, users } from "../db/schema";
import { WorkflowError } from "./cases";

const ISSUER = "Threadline";
type User = typeof users.$inferSelect;

export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${ISSUER}:${email}`)}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=30`;

const secretContext = (userId: string) => `totp:${userId}`;
const hashCodes = (codes: string[]) => codes.map((c) => hashPassword(normalizeRecoveryCode(c)));

/**
 * Check a second factor inside a transaction that holds the user's row lock: either a fresh
 * authenticator code (later than the last one accepted) or an unused recovery code, which is
 * then spent. Returns how the person verified, or null.
 */
async function consumeSecondFactor(tx: Tx, u: User, code: string, atMs: number): Promise<"authenticator" | "recovery_code" | null> {
  if (!u.totpEnabled || !u.totpSecret) return null;
  const step = matchTotpStep(openSecret(u.totpSecret, secretContext(u.id)), code, atMs);
  if (step !== null && (u.totpLastStep === null || step > u.totpLastStep)) {
    await tx.update(users).set({ totpLastStep: step }).where(eq(users.id, u.id));
    return "authenticator";
  }
  if (looksLikeRecoveryCode(code)) {
    const clean = normalizeRecoveryCode(code);
    const i = u.recoveryCodes.findIndex((h) => verifyPassword(clean, h));
    if (i >= 0) {
      const remaining = u.recoveryCodes.filter((_, j) => j !== i);
      await tx.update(users).set({ recoveryCodes: remaining }).where(eq(users.id, u.id));
      await audit(tx, { userId: u.id, userName: u.fullName, orgId: u.orgId }, "account.recovery_code_used", "user", u.id, { remaining: remaining.length });
      return "recovery_code";
    }
  }
  return null;
}

const lockUser = (tx: Tx, userId: string) => tx.select().from(users).where(eq(users.id, userId)).for("update").then((r) => r[0]);

/** Sign-in: called after the password has been checked, before a session exists. */
export async function verifySignInSecondFactor(userId: string, code: string, atMs = Date.now()) {
  const db = await getDb("system"); // the person is not signed in yet
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, userId);
    return u ? consumeSecondFactor(tx, u, code, atMs) : null;
  });
}

export async function getAccount(ctx: AccessContext) {
  const db = await getDb(ctx);
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
  const [s] = await db.select({ requireTwoStep: orgSettings.requireTwoStep }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
  return {
    email: u.email, fullName: u.fullName, jobTitle: u.jobTitle,
    twoStepEnabled: u.totpEnabled, enrolmentPending: !u.totpEnabled && !!u.totpSecret,
    recoveryCodesLeft: u.totpEnabled ? u.recoveryCodes.length : 0,
    requiredByOrganization: !!s?.requireTwoStep,
  };
}

/** Starts (or restarts) enrolment. Sign-in is unaffected until a code from the app is confirmed. */
export async function beginTwoStepEnrolment(ctx: AccessContext) {
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, ctx.userId);
    if (u.totpEnabled) throw new WorkflowError("Two-step verification is already on for this account.");
    const secret = generateTotpSecret();
    await tx.update(users).set({ totpSecret: sealSecret(secret, secretContext(u.id)), totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.two_step_enrolment_started", "user", u.id, {});
    return { secret, uri: otpauthUri(u.email, secret) };
  });
}

/** Turns two-step on once a code from the app matches. Returns the recovery codes, shown once. */
export async function confirmTwoStepEnrolment(ctx: AccessContext, code: string, atMs = Date.now()) {
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, ctx.userId);
    if (u.totpEnabled) throw new WorkflowError("Two-step verification is already on for this account.");
    if (!u.totpSecret) throw new WorkflowError("Start set-up first.");
    const step = matchTotpStep(openSecret(u.totpSecret, secretContext(u.id)), code, atMs);
    if (step === null) throw new WorkflowError("That code does not match. Check the time on your phone and enter the current code.");
    const recoveryCodes = generateRecoveryCodes();
    await tx.update(users).set({ totpEnabled: true, totpLastStep: step, recoveryCodes: hashCodes(recoveryCodes) }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.two_step_enabled", "user", u.id, { recoveryCodes: recoveryCodes.length });
    return { enabled: true, recoveryCodes };
  });
}

/** Replaces all recovery codes. Needs a current authenticator code or an unused recovery code. */
export async function regenerateRecoveryCodes(ctx: AccessContext, code: string, atMs = Date.now()) {
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, ctx.userId);
    if (!u.totpEnabled) throw new WorkflowError("Two-step verification is not on for this account.");
    if (!(await consumeSecondFactor(tx, u, code, atMs))) throw new WorkflowError("That code is not valid. Enter the current code from your app.");
    const recoveryCodes = generateRecoveryCodes();
    await tx.update(users).set({ recoveryCodes: hashCodes(recoveryCodes) }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.recovery_codes_regenerated", "user", u.id, { recoveryCodes: recoveryCodes.length });
    return { recoveryCodes };
  });
}

/**
 * Turning it off needs the password and a second factor, so a borrowed session is not enough.
 * Not allowed while the organization requires two-step verification.
 */
export async function disableTwoStep(ctx: AccessContext, input: { password: string; code: string }, atMs = Date.now()) {
  const db = await getDb(ctx);
  return db.transaction(async (tx) => {
    const u = await lockUser(tx, ctx.userId);
    if (!u.totpEnabled || !u.totpSecret) return { enabled: false };
    const [s] = await tx.select({ requireTwoStep: orgSettings.requireTwoStep }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
    if (s?.requireTwoStep) throw new WorkflowError("Your organization requires two-step verification, so it cannot be turned off.");
    if (!verifyPassword(input.password, u.passwordHash) || !(await consumeSecondFactor(tx, u, input.code, atMs))) throw new WorkflowError("Password or verification code is incorrect.");
    await tx.update(users).set({ totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.two_step_disabled", "user", u.id, {});
    return { enabled: false };
  });
}
