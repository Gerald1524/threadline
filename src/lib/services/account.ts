/**
 * A person's own sign-in settings: two-step verification with an authenticator app
 * (time-based codes, RFC 6238). Every change is audited; the secret itself never is.
 */
import { eq } from "drizzle-orm";
import type { AccessContext } from "../access";
import { audit } from "../audit";
import { generateTotpSecret, verifyPassword, verifyTotp } from "../auth/password";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { WorkflowError } from "./cases";

const ISSUER = "Threadline";

export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${ISSUER}:${email}`)}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=30`;

export async function getAccount(ctx: AccessContext) {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
  return { email: u.email, fullName: u.fullName, jobTitle: u.jobTitle, twoStepEnabled: u.totpEnabled, enrolmentPending: !u.totpEnabled && !!u.totpSecret };
}

/** Starts (or restarts) enrolment. Sign-in is unaffected until a code from the app is confirmed. */
export async function beginTwoStepEnrolment(ctx: AccessContext) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, ctx.userId));
    if (u.totpEnabled) throw new WorkflowError("Two-step verification is already on for this account.");
    const secret = generateTotpSecret();
    await tx.update(users).set({ totpSecret: secret }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.two_step_enrolment_started", "user", u.id, {});
    return { secret, uri: otpauthUri(u.email, secret) };
  });
}

export async function confirmTwoStepEnrolment(ctx: AccessContext, code: string, atMs = Date.now()) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, ctx.userId));
    if (u.totpEnabled) return { enabled: true };
    if (!u.totpSecret) throw new WorkflowError("Start set-up first.");
    if (!verifyTotp(u.totpSecret, code, atMs)) throw new WorkflowError("That code does not match. Check the time on your phone and enter the current code.");
    await tx.update(users).set({ totpEnabled: true }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.two_step_enabled", "user", u.id, {});
    return { enabled: true };
  });
}

/** Turning it off needs both the password and a current code, so a borrowed session is not enough. */
export async function disableTwoStep(ctx: AccessContext, input: { password: string; code: string }, atMs = Date.now()) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, ctx.userId));
    if (!u.totpEnabled || !u.totpSecret) return { enabled: false };
    if (!verifyPassword(input.password, u.passwordHash) || !verifyTotp(u.totpSecret, input.code, atMs)) throw new WorkflowError("Password or verification code is incorrect.");
    await tx.update(users).set({ totpEnabled: false, totpSecret: null }).where(eq(users.id, u.id));
    await audit(tx, ctx, "account.two_step_disabled", "user", u.id, {});
    return { enabled: false };
  });
}
