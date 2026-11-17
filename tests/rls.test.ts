import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, rowLevelSecurityStatus } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { as, useSeededDb } from "./helpers/db";

/**
 * Organization isolation enforced by the database (drizzle/0002_row_level_security.sql).
 * These queries deliberately omit the organization filter that application code always
 * applies: the database must still return and accept only the caller's organization.
 */
describe("row-level security", () => {
  useSeededDb();
  const priya = as("u_priya"), helen = as("u_helen");
  const rowsOf = (r: unknown) => (r as { rows: Record<string, unknown>[] }).rows;
  /** The database's own error message (drizzle wraps it as "Failed query: ..."). */
  const dbError = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const err = e as Error & { cause?: Error };
      return err.cause?.message ?? err.message;
    }
    return "no error";
  };

  it("is enabled on every table", async () => {
    const s = await rowLevelSecurityStatus();
    expect(s.unprotected).toEqual([]);
    expect(s.tables).toBeGreaterThanOrEqual(34);
    expect(s.enforced).toBe(true);
  });

  it("an organization handle runs as the unprivileged role with its organization set", async () => {
    const db = await getDb(priya);
    const [row] = rowsOf(await db.execute(sql`select current_user as role, current_setting('app.org_id', true) as org`));
    expect(row).toEqual({ role: "threadline_app", org: "org_northbridge" });
    const [sys] = rowsOf(await (await getDb("system")).execute(sql`select current_user as role, coalesce(current_setting('app.org_id', true), '') as org`));
    expect(sys.role).not.toBe("threadline_app");
    expect(sys.org).toBe("");
  });

  it("an unfiltered read returns only the caller's organization", async () => {
    const all = await (await getDb("system")).select({ orgId: t.cases.orgId }).from(t.cases);
    expect(new Set(all.map((c) => c.orgId))).toEqual(new Set(["org_northbridge", "org_harborview"]));
    for (const [ctx, org] of [[priya, "org_northbridge"], [helen, "org_harborview"]] as const) {
      const db = await getDb(ctx);
      const cases = await db.select({ orgId: t.cases.orgId }).from(t.cases);
      expect(cases.length).toBe(all.filter((c) => c.orgId === org).length);
      expect(new Set(cases.map((c) => c.orgId))).toEqual(new Set([org]));
      const records = await db.select({ orgId: t.sourceRecords.orgId }).from(t.sourceRecords);
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((r) => r.orgId === org)).toBe(true);
      expect((await db.select().from(t.organizations)).map((o) => o.id)).toEqual([org]);
      expect((await db.select().from(t.users)).every((u) => u.orgId === org)).toBe(true);
    }
    expect(await (await getDb({ orgId: "org_unknown" })).select().from(t.cases)).toEqual([]);
  });

  it("refuses to write another organization's rows, inside or outside a transaction", async () => {
    const db = await getDb(priya);
    const [calder] = await (await getDb("system")).select().from(t.cases).where(eq(t.cases.orgId, "org_harborview"));
    expect(await db.update(t.cases).set({ title: "changed" }).where(eq(t.cases.id, calder.id)).returning()).toEqual([]);
    expect(await db.delete(t.reviewItems).where(eq(t.reviewItems.orgId, "org_harborview")).returning()).toEqual([]);
    expect(await dbError(db.insert(t.legalHolds).values({ id: "hold_rls_probe", orgId: "org_harborview", propertyId: calder.propertyId, caseId: calder.id, reason: "probe", placedBy: "u_priya" })))
      .toMatch(/violates row-level security policy/);
    expect(await dbError(db.transaction(async (tx) => {
      await tx.update(t.cases).set({ orgId: "org_harborview" }).where(eq(t.cases.number, "C-1001"));
    }))).toMatch(/violates row-level security policy/);
    const [after] = await (await getDb("system")).select().from(t.cases).where(eq(t.cases.id, calder.id));
    expect(after.title).toBe(calder.title);
  });

  it("the runtime role is not granted changes to the audit log or deletion of originals", async () => {
    const db = await getDb(priya);
    expect(await dbError(db.execute(sql`update audit_log set action = 'x' where seq = 1`))).toMatch(/permission denied for table audit_log/);
    expect(await dbError(db.execute(sql`delete from audit_log`))).toMatch(/permission denied for table audit_log/);
    expect(await dbError(db.execute(sql`delete from source_records`))).toMatch(/permission denied for table source_records/);
  });

  it("pooled connections never carry one organization's scope into another request", async () => {
    const north = await getDb(priya), harbor = await getDb(helen), system = await getDb("system");
    const runs = Array.from({ length: 24 }, (_, i) => {
      const [db, org] = i % 3 === 0 ? [north, "org_northbridge"] : i % 3 === 1 ? [harbor, "org_harborview"] : [system, null];
      return (i % 2 ? db.transaction((tx) => tx.select({ orgId: t.cases.orgId }).from(t.cases)) : db.select({ orgId: t.cases.orgId }).from(t.cases))
        .then((rows) => ({ org, orgs: new Set(rows.map((r) => r.orgId)) }));
    });
    for (const r of await Promise.all(runs)) {
      if (r.org) expect(r.orgs).toEqual(new Set([r.org]));
      else expect(r.orgs.size).toBe(2);
    }
  });
});
