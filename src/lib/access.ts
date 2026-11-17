/**
 * Deterministic authorization. This module — not a model prompt — is the enforcement
 * boundary. Every service and every agent tool receives an AccessContext and must scope
 * its queries with `scopeOf(ctx)` and check capabilities with `assertCan`.
 */
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const ROLES = ["temp_concierge", "concierge", "porter", "superintendent", "community_manager", "regional_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  temp_concierge: "Temp concierge",
  concierge: "Concierge",
  porter: "Porter / maintenance",
  superintendent: "Superintendent",
  community_manager: "Community manager",
  regional_admin: "Regional / property admin",
};

export type Capability =
  | "ask" | "activity.read" | "activity.write" | "cases.read" | "cases.manage" | "sources.read"
  | "management.read" | "restricted.read" | "resident.contact"
  | "workorders.read" | "workorders.update" | "workorders.create"
  | "approvals.read" | "approvals.request" | "approvals.decide"
  | "messages.draft" | "messages.send.maintenance" | "messages.send.resident"
  | "policies.read" | "policies.drafts" | "handoffs.read" | "handoffs.write"
  | "review.read" | "review.resolve" | "reports.read" | "reports.generate"
  | "ingest.run" | "privacy.view" | "privacy.admin" | "audit.read" | "briefing";

const FRONT_DESK: Capability[] = [
  "ask", "activity.read", "activity.write", "cases.read", "sources.read", "workorders.read",
  "approvals.read", "approvals.request", "policies.read", "handoffs.read", "handoffs.write",
  "messages.draft", "messages.send.maintenance",
];

const MANAGER: Capability[] = [
  ...FRONT_DESK, "resident.contact", "cases.manage", "management.read", "restricted.read",
  "workorders.update", "workorders.create", "approvals.decide", "messages.send.resident",
  "policies.drafts", "review.read", "review.resolve", "reports.read", "reports.generate",
  "ingest.run", "privacy.view", "audit.read", "briefing",
];

export const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  temp_concierge: FRONT_DESK,
  concierge: [...FRONT_DESK, "resident.contact", "briefing"],
  porter: ["ask", "activity.read", "activity.write", "cases.read", "sources.read", "workorders.read", "workorders.update", "policies.read", "handoffs.read"],
  superintendent: [...FRONT_DESK, "resident.contact", "workorders.update", "workorders.create", "review.read", "briefing"],
  community_manager: MANAGER,
  regional_admin: [...MANAGER, "privacy.admin"],
};

export type Visibility = "staff" | "management" | "restricted";

export type AccessContext = {
  userId: string;
  userName: string;
  orgId: string;
  propertyId: string;
  propertyName: string;
  timezone: string;
  role: Role;
  employmentType: string;
  /** The organization requires two-step verification and this person has not set it up. */
  mustEnrollTwoStep?: boolean;
};

export class AccessDenied extends Error {
  constructor(public capability: string) {
    super(`Not permitted: ${capability}`);
    this.name = "AccessDenied";
  }
}

export const can = (ctx: AccessContext, cap: Capability) => ROLE_CAPS[ctx.role].includes(cap);

export function assertCan(ctx: AccessContext, cap: Capability) {
  if (!can(ctx, cap)) throw new AccessDenied(cap);
}

export function visibleLevels(ctx: AccessContext): Visibility[] {
  const levels: Visibility[] = ["staff"];
  if (can(ctx, "management.read")) levels.push("management");
  if (can(ctx, "restricted.read")) levels.push("restricted");
  return levels;
}

type ScopedTable = { orgId: AnyPgColumn; propertyId: AnyPgColumn };

/** Tenant + property predicate. Use on every query against a tenant-owned table. */
export function scopeOf(ctx: AccessContext, t: ScopedTable): SQL {
  return and(eq(t.orgId, ctx.orgId), eq(t.propertyId, ctx.propertyId))!;
}

/** Tenant + property + visibility predicate for tables that carry a visibility column. */
export function visibleScope(ctx: AccessContext, t: ScopedTable & { visibility: AnyPgColumn }): SQL {
  return and(scopeOf(ctx, t), inArray(t.visibility, visibleLevels(ctx)))!;
}

/** System actor used by ingestion jobs and seeding; never reachable from a request. */
export const systemContext = (orgId: string, propertyId: string, propertyName = "", timezone = "America/New_York"): AccessContext => ({
  userId: "system:ingest", userName: "Threadline ingestion", orgId, propertyId, propertyName, timezone, role: "regional_admin", employmentType: "system",
});
