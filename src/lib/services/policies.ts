import { and, eq } from "drizzle-orm";
import { assertCan, can, scopeOf, type AccessContext } from "../access";
import { getDb } from "../db/client";
import { policies, policyVersions } from "../db/schema";

export type PolicyView = { id: string; key: string; title: string; category: string; current: typeof policyVersions.$inferSelect | null; versions: (typeof policyVersions.$inferSelect)[] };

/** Approved versions are visible to all staff; drafts only to roles holding policies.drafts. */
export async function listPolicies(ctx: AccessContext): Promise<PolicyView[]> {
  assertCan(ctx, "policies.read");
  const db = await getDb(ctx);
  const ps = await db.select().from(policies).where(scopeOf(ctx, policies)).orderBy(policies.title);
  const vs = await db.select().from(policyVersions).where(scopeOf(ctx, policyVersions));
  const seeDrafts = can(ctx, "policies.drafts");
  return ps.map((p) => {
    const versions = vs.filter((v) => v.policyId === p.id && (seeDrafts || v.status !== "draft")).sort((a, b) => b.version - a.version);
    return { id: p.id, key: p.key, title: p.title, category: p.category, current: versions.find((v) => v.status === "approved") ?? null, versions };
  });
}

/** The authoritative policy for a topic: the single approved version, never a draft or superseded text. */
export async function currentPolicyFor(ctx: AccessContext, by: { key?: string; category?: string }) {
  const all = await listPolicies(ctx);
  return all.find((p) => (by.key ? p.key === by.key : p.category === by.category) && p.current) ?? null;
}

export async function getPolicyVersion(ctx: AccessContext, id: string) {
  assertCan(ctx, "policies.read");
  const db = await getDb(ctx);
  const [v] = await db.select().from(policyVersions).where(and(eq(policyVersions.id, id), scopeOf(ctx, policyVersions)));
  if (!v || (v.status === "draft" && !can(ctx, "policies.drafts"))) return null;
  return v;
}
