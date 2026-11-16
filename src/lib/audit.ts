/**
 * Append-only, hash-chained audit trail. Entries describe who did what to which entity;
 * `meta` must contain identifiers and state names only — never record content.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { AccessContext } from "./access";
import type { Queryable } from "./db/client";
import { auditLog } from "./db/schema";
import { newId, sha256 } from "./util/core";

export type AuditActor = Pick<AccessContext, "userId" | "userName" | "orgId"> & { propertyId?: string | null };

export async function audit(
  q: Queryable,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  meta: Record<string, unknown> = {},
  at: Date = new Date(),
) {
  // Serialize appends per organization so seq and the hash chain stay consistent.
  await q.execute(sql`select pg_advisory_xact_lock(hashtext(${"audit:" + actor.orgId}))`);
  const [last] = await q.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog).where(eq(auditLog.orgId, actor.orgId)).orderBy(desc(auditLog.seq)).limit(1);
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? "genesis";
  const isSystem = actor.userId.startsWith("system:");
  const body = { orgId: actor.orgId, seq, at: at.toISOString(), actor: isSystem ? "system" : actor.userId, action, entityType, entityId, meta };
  const hash = sha256(prevHash + JSON.stringify(body));
  await q.insert(auditLog).values({
    id: newId("aud"), orgId: actor.orgId, propertyId: actor.propertyId ?? null, seq, at,
    actorUserId: isSystem ? null : actor.userId, actorLabel: actor.userName, action, entityType, entityId, meta, prevHash, hash,
  });
}

/** Recompute the chain; returns the first broken sequence number, or null if intact. */
export async function verifyAuditChain(q: Queryable, orgId: string): Promise<{ entries: number; brokenAt: number | null }> {
  const rows = await q.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(auditLog.seq);
  let prev = "genesis";
  for (const r of rows) {
    const body = { orgId: r.orgId, seq: r.seq, at: r.at.toISOString(), actor: r.actorUserId ?? "system", action: r.action, entityType: r.entityType, entityId: r.entityId, meta: r.meta };
    const ok = r.prevHash === prev && sha256(prev + JSON.stringify(body)) === r.hash;
    if (!ok) return { entries: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { entries: rows.length, brokenAt: null };
}
