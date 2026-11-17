import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AccessDenied, ROLE_CAPS, can } from "@/lib/access";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { ask } from "@/lib/engine/ask";
import { buildCaseEvidence } from "@/lib/engine/evidence";
import { searchRecords } from "@/lib/engine/search";
import { decideApproval, listApprovals } from "@/lib/services/approvals";
import { getCase, getSourceRecord, listCases, setCaseStatus } from "@/lib/services/cases";
import { listHandoffs } from "@/lib/services/handoffs";
import { exportOrganization, getPrivacyOverview, listAudit } from "@/lib/services/privacy";
import { generatePacket, getReportPdf, listReports } from "@/lib/services/reports";
import { listReviewItems } from "@/lib/services/review";
import { listWorkOrders } from "@/lib/services/workorders";
import { listPolicies } from "@/lib/services/policies";
import { readBlob } from "@/lib/storage";
import { NOW, as, useSeededDb } from "./helpers/db";

/**
 * Two organizations (Northbridge, Harborview) and two Northbridge properties (Riverside
 * House, Riverside Annex). Calder Court (Harborview) deliberately has its own "12B" smoke
 * complaint so that a leak would be easy to spot.
 */
describe("tenant, property and role isolation", () => {
  useSeededDb();
  const priya = as("u_priya"), helen = as("u_helen", "prop_calder"), nina = as("u_nina", "prop_annex"), michael = as("u_michael"), sam = as("u_sam"), carlos = as("u_carlos");
  const riversideSmoke = async () => {
    const db = await getDb("system");
    const [c] = await db.select().from(t.cases).where(and(eq(t.cases.propertyId, "prop_riverside"), eq(t.cases.number, "C-1001")));
    const [sr] = await db.select().from(t.sourceRecords).where(eq(t.sourceRecords.externalId, "FD-1005-07"));
    const [mail] = await db.select().from(t.sourceRecords).where(eq(t.sourceRecords.externalId, "<smoke-06@mail.riversidehouse.example>"));
    const [blob] = await db.select().from(t.blobs).where(eq(t.blobs.sourceRecordId, mail.id));
    return { c, sr, mail, blob };
  };

  it("another organization cannot read a case, a source record, an attachment or evidence by id", async () => {
    const { c, sr, blob } = await riversideSmoke();
    const db = await getDb("system");
    expect(await getCase(helen, c.id)).toBeNull();
    expect(await getSourceRecord(helen, sr.id)).toBeNull();
    expect(await buildCaseEvidence(helen, c.id)).toBeNull();
    expect(await readBlob(db, helen, blob.id)).toBeNull();
  });

  it("another organization's lists, search and timelines contain nothing from Riverside", async () => {
    for (const rows of [await listCases(helen), await listWorkOrders(helen), await listApprovals(helen), await listHandoffs(helen), await listReviewItems(helen, "all"), await listPolicies(helen), await listReports(helen)]) {
      expect(rows.every((r) => (r as { propertyId?: string }).propertyId !== "prop_riverside")).toBe(true);
    }
    expect((await listCases(helen)).map((c) => c.title)).toEqual(["Smoke / odor — 12B (reported by 12A)"]);
    for (const q of ["Whitfield cigarette smoke 12B", "Carlos trash chute odor", "Carter replacement key", "courtesy notice smoke-free"]) {
      const hits = await searchRecords(helen, q, 20);
      expect(hits.every((h) => !/whitfield|carlos|carter|riverside/i.test(`${h.title} ${h.snippet}`))).toBe(true);
    }
    const audit = await listAudit(helen, 500);
    expect(audit.every((a) => a.orgId === "org_harborview")).toBe(true);
  });

  it("conversation follow-ups cannot be used to reach another tenant's conversation or case", async () => {
    const { conversationId } = await ask(priya, { question: "What do we know about the smoke complaints about 12B?" }, { now: NOW });
    // Helen replays Priya's conversation id and asks a context-dependent follow-up.
    const { answer, conversationId: own } = await ask(helen, { question: "Did anyone actually smell smoke?", conversationId }, { now: NOW });
    expect(own).not.toBe(conversationId);
    const text = JSON.stringify(answer);
    expect(text).not.toMatch(/Whitfield|Reyes|Carlos Mendez|Riverside House/);
    expect(answer.caseRef?.title ?? "Smoke / odor — 12B (reported by 12A)").toBe("Smoke / odor — 12B (reported by 12A)");
  });

  it("reports and exports are tenant-scoped", async () => {
    const { c } = await riversideSmoke();
    const { report } = await generatePacket(priya, { caseId: c.id, reviewed: true, now: NOW });
    expect(await getReportPdf(helen, report.id)).toBeNull();
    await expect(generatePacket(helen, { caseId: c.id, reviewed: true })).rejects.toThrow(/not found/i);
    const exp = await exportOrganization(as("u_marcus"));
    const db = await getDb("system");
    const { bytes } = (await readBlob(db, as("u_marcus"), exp.blobId!))!;
    const data = JSON.parse(new TextDecoder().decode(bytes));
    expect(new Set(data.tables.source_records.map((r: { orgId: string }) => r.orgId))).toEqual(new Set(["org_northbridge"]));
    expect(JSON.stringify(data)).not.toMatch(/Farah Amari|Calder Court|Leonard Voss/);
    expect(await readBlob(db, helen, exp.blobId!)).toBeNull();
  });

  it("a second property in the same organization is isolated too", async () => {
    const { c, sr } = await riversideSmoke();
    expect(await getCase(nina, c.id)).toBeNull();
    expect(await getSourceRecord(nina, sr.id)).toBeNull();
    expect((await listCases(nina)).map((x) => x.title)).toEqual(["Smoke / odor — 2A (reported by 3B)"]);
    const hits = await searchRecords(nina, "Whitfield cigarette smoke 12B", 20);
    expect(hits.map((h) => h.externalId)).toEqual(["AX-1012-01"]); // the Annex's own record, nothing from Riverside
    expect((await listCases(priya)).some((x) => x.title.includes("2A (reported by 3B)"))).toBe(false);
  });

  it("front-desk roles do not see management correspondence, and are told that records are restricted", async () => {
    const { c, mail, blob } = await riversideSmoke();
    const db = await getDb("system");
    expect(await getSourceRecord(michael, mail.id)).toBeNull();
    await expect(readBlob(db, michael, blob.id)).rejects.toThrow(AccessDenied);
    const ev = (await buildCaseEvidence(michael, c.id, NOW))!;
    expect(ev.items.some((i) => i.channel === "email")).toBe(false);
    expect(ev.hiddenCount).toBeGreaterThan(0);
    expect((await searchRecords(michael, "attorney written response", 20)).length).toBe(0);
    expect((await searchRecords(priya, "attorney written response", 20)).length).toBeGreaterThan(0);
  });

  it("capabilities are enforced by the services, not the UI", async () => {
    const { c } = await riversideSmoke();
    const [pending] = (await listApprovals(priya)).filter((a) => a.status === "pending");
    await expect(decideApproval(michael, { id: pending.id, decision: "approved" })).rejects.toThrow(AccessDenied);
    await expect(decideApproval(sam, { id: pending.id, decision: "approved" })).rejects.toThrow(AccessDenied);
    await expect(generatePacket(michael, { caseId: c.id, reviewed: true })).rejects.toThrow(AccessDenied);
    await expect(setCaseStatus(carlos, { caseId: c.id, status: "resolved" })).rejects.toThrow(AccessDenied);
    await expect(listReviewItems(sam)).rejects.toThrow(AccessDenied);
    await expect(getPrivacyOverview(michael)).rejects.toThrow(AccessDenied);
    await expect(exportOrganization(priya)).rejects.toThrow(AccessDenied);
    await expect(listAudit(carlos)).rejects.toThrow(AccessDenied);
  });

  it("the role matrix keeps consequential powers with managers and admins", () => {
    for (const role of ["temp_concierge", "concierge", "porter", "superintendent"] as const) {
      for (const cap of ["approvals.decide", "messages.send.resident", "reports.generate", "privacy.admin", "management.read", "review.resolve"] as const) expect(ROLE_CAPS[role].includes(cap)).toBe(false);
    }
    expect(can(as("u_priya"), "privacy.admin")).toBe(false);
    expect(can(as("u_marcus"), "privacy.admin")).toBe(true);
    expect(can(as("u_sam"), "resident.contact")).toBe(false);
  });

  it("a property briefing is refused to roles without it", async () => {
    const { answer } = await ask(carlos, { question: "What should I know about this property?" }, { now: NOW });
    expect(answer.headline).toMatch(/not available to your role/);
    expect(answer.claims).toEqual([]);
  });
});
