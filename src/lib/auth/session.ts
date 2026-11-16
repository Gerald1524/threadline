import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb } from "../db/client";
import { memberships, properties, users } from "../db/schema";
import { AccessDenied, can, type AccessContext, type Capability, type Role } from "../access";

const COOKIE = "tl_session";
const MAX_AGE_S = 60 * 60 * 10; // one long shift

function secret(): Uint8Array {
  let s = process.env.SESSION_SECRET;
  if (!s) {
    // Dev convenience: persist a random secret beside the embedded database (never committed).
    const file = path.join(dataDir(), "session-secret");
    if (fs.existsSync(file)) s = fs.readFileSync(file, "utf8");
    else {
      fs.mkdirSync(dataDir(), { recursive: true });
      s = randomBytes(32).toString("hex");
      fs.writeFileSync(file, s, { mode: 0o600 });
    }
  }
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string, propertyId: string) {
  const token = await new SignJWT({ pid: propertyId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${MAX_AGE_S}s`).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.THREADLINE_INSECURE_COOKIES !== "1", path: "/", maxAge: MAX_AGE_S });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Memberships a user may act under. An org-wide membership expands to every property in the org. */
export async function listAccessibleProperties(userId: string) {
  const db = await getDb();
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.active, true)));
  if (!user) return { user: null, options: [] as { propertyId: string; propertyName: string; timezone: string; role: Role }[] };
  const ms = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.orgId, user.orgId)));
  const props = await db.select().from(properties).where(eq(properties.orgId, user.orgId));
  const options = props.flatMap((p) => {
    const m = ms.find((x) => x.propertyId === p.id) ?? ms.find((x) => x.propertyId === null);
    return m ? [{ propertyId: p.id, propertyName: p.name, timezone: p.timezone, role: m.role as Role }] : [];
  });
  return { user, options };
}

/**
 * Resolve the caller's access context from the session cookie. Role and membership are
 * re-read from the database on every request, so a role change or deactivation takes effect
 * immediately rather than at token expiry.
 */
export async function getContext(): Promise<AccessContext | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined, pid: string | undefined;
  try {
    const { payload } = await jwtVerify(token, secret());
    sub = payload.sub;
    pid = payload.pid as string;
  } catch {
    return null;
  }
  if (!sub) return null;
  const { user, options } = await listAccessibleProperties(sub);
  const opt = options.find((o) => o.propertyId === pid);
  if (!user || !opt) return null;
  return { userId: user.id, userName: user.fullName, orgId: user.orgId, propertyId: opt.propertyId, propertyName: opt.propertyName, timezone: opt.timezone, role: opt.role, employmentType: user.employmentType };
}

export async function requireContext(cap?: Capability): Promise<AccessContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (cap && !can(ctx, cap)) throw new AccessDenied(cap);
  return ctx;
}
