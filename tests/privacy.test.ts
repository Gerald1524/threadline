import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authorizeProvider } from "@/lib/ai/provider";
import { evidenceForModel } from "@/lib/ai/narrate";
import { verifyAuditChain } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { ask, setNarratorForTests } from "@/lib/engine/ask";
import { composeCaseOverview } from "@/lib/engine/compose";
import { buildCaseEvidence } from "@/lib/engine/evidence";
import { redactForModel } from "@/lib/ingest/lexicon";
import { decideLifecycle, exportOrganization, getPrivacyOverview, proposeLifecycle, releaseLegalHold, updateProviderPolicy, updateRetention } from "@/lib/services/privacy";
import { generatePacket } from "@/lib/services/reports";
import { readBlob } from "@/lib/storage";
import { NOW, as, useSeededDb } from "./helpers/db";

describe("organization data controls", () => {
  useSeededDb();
  const marcus = as("u_marcus"), priya = as("u_priya");
  const smokeCase = async () => (await (await getDb()).select().from(t.cases).where(and(eq(t.cases.propertyId, "prop_riverside"), eq(t.cases.number, "C-1001"))))[0];

  it("shows the source inventory with scopes, freshness, coverage and failures", async () => {
    const o = await getPrivacyOverview(marcus);
    const by = (id: string) => o.sources.find((s) => s.id === id)!;
    expect(by("src_mgmt_mailbox")).toMatchObject({ status: "active", defaultVisibility: "management" });
    expect(by("src_mgmt_mailbox").coverageNote).toContain("Export taken Nov 13");
    expect(by("src_temp_log").failedJobs).toHaveLength(1);
    expect(by("src_m365")).toMatchObject({ status: "planned", records: 0 });
    expect(by("src_frontdesk_log").records).toBeGreaterThanOrEqual(75);
    expect(o.chain.brokenAt).toBeNull();
    expect(o.providers.find((p) => p.task === "reasoning")!.selected).toBe("anthropic");
  });

  it("provider policy: a disallowed provider or sensitivity class is blocked, never silently swapped", async () => {
    const sens = ["internal_ops", "confidential_case"];
    process.env.ANTHROPIC_API_KEY = "test-placeholder";
    expect(await authorizeProvider(priya, "reasoning", "anthropic", sens)).toMatchObject({ allowed: true });
    await updateProviderPolicy(marcus, { task: "reasoning", provider: "anthropic", allowedSensitivity: ["public_policy", "internal_ops"] });
    expect(await authorizeProvider(priya, "reasoning", "anthropic", sens)).toMatchObject({ allowed: false, status: "blocked_by_policy" });
    expect(await authorizeProvider(priya, "reasoning", "anthropic", ["public_policy"])).toMatchObject({ allowed: true });
    await updateProviderPolicy(marcus, { task: "reasoning", provider: "none", allowedSensitivity: [] });
    expect(await authorizeProvider(priya, "reasoning", "anthropic", ["public_policy"])).toMatchObject({ allowed: false, status: "blocked_by_policy" });
    delete process.env.ANTHROPIC_API_KEY;
    await updateProviderPolicy(marcus, { task: "reasoning", provider: "anthropic", allowedSensitivity: ["public_policy", "internal_ops", "resident_pi", "confidential_case"] });
    expect(await authorizeProvider(priya, "reasoning", "anthropic", ["public_policy"])).toMatchObject({ allowed: false, status: "not_configured" });
    await expect(updateProviderPolicy(marcus, { task: "reasoning", provider: "deepseek", allowedSensitivity: [] })).rejects.toThrow(/not on the shortlist/);
    await expect(updateProviderPolicy(priya, { task: "reasoning", provider: "none", allowedSensitivity: [] })).rejects.toThrow(/Not permitted/);
  });

  it("with a key present but policy blocking, Ask answers deterministically, says why, and logs metadata only", async () => {
    const db = await getDb();
    await updateProviderPolicy(marcus, { task: "reasoning", provider: "none", allowedSensitivity: [] });
    process.env.ANTHROPIC_API_KEY = "test-placeholder";
    setNarratorForTests(undefined); // use the real gate
    const { answer } = await ask(priya, { question: "What do we know about the smoke complaints about 12B?" }, { now: NOW });
    delete process.env.ANTHROPIC_API_KEY;
    setNarratorForTests(null);
    expect(answer.mode).toBe("deterministic");
    expect(answer.modeNote).toMatch(/AI policy does not allow.*no data was sent/);
    const logs = await db.select().from(t.providerRequests).where(eq(t.providerRequests.orgId, "org_northbridge"));
    expect(logs.at(-1)).toMatchObject({ provider: "anthropic", task: "reasoning", status: "blocked_by_policy", maxSensitivity: "confidential_case" });
    expect(Object.keys(logs[0])).not.toContain("prompt");
    await updateProviderPolicy(marcus, { task: "reasoning", provider: "anthropic", allowedSensitivity: ["public_policy", "internal_ops", "employee_pi", "resident_pi", "confidential_case"] });
  });

  it("what would be sent to a model is minimized: flagged records withheld, contact details redacted", async () => {
    const ev = (await buildCaseEvidence(priya, (await smokeCase()).id, NOW))!;
    const payload = JSON.stringify(evidenceForModel(composeCaseOverview(priya, ev)));
    expect(payload).not.toMatch(/Ignore all previous instructions|lease termination/);
    expect(payload).toContain("Content withheld from the model");
    expect(payload).not.toMatch(/@example\.net|@mailbox\.example/);
    expect(redactForModel("Call 212-555-0142 or write e.whitfield@example.net")).toBe("Call [phone] or write [email]");
  });

  it("retention is configurable per record class and the change is audited", async () => {
    await updateRetention(marcus, { recordClass: "internal_ops", days: 730 });
    expect((await getPrivacyOverview(marcus)).settings.retention.internal_ops).toEqual({ days: 730 });
    await expect(updateRetention(priya, { recordClass: "internal_ops", days: 30 })).rejects.toThrow(/Not permitted/);
  });

  it("approved disposal skips records under legal hold and propagates to derived data", async () => {
    const db = await getDb();
    const c = await smokeCase();
    await ask(priya, { question: "What do we know about the noise complaints from 5E about 6E?" }, { now: NOW }); // a cached answer citing noise records
    const [noise] = await db.select().from(t.cases).where(and(eq(t.cases.propertyId, "prop_riverside"), eq(t.cases.number, "C-1006")));
    const { report } = await generatePacket(priya, { caseId: noise.id, reviewed: true, now: NOW });
    const req = await proposeLifecycle(marcus, { action: "dispose", recordClass: "confidential_case", olderThan: new Date("2026-12-01T00:00:00Z") });
    expect(req.status).toBe("proposed");
    expect(req.heldCount).toBeGreaterThanOrEqual(9); // smoke case emails are on hold
    await expect(decideLifecycle(marcus, { id: req.id, decision: "execute", confirm: "yes" })).rejects.toThrow(/Type DISPOSE/);
    const done = await decideLifecycle(marcus, { id: req.id, decision: "execute", confirm: "DISPOSE" });
    expect(done).toMatchObject({ status: "executed", heldCount: req.heldCount });
    expect((done as { affectedCount: number }).affectedCount).toBe(req.matchedCount - req.heldCount);

    // Held: the smoke case is fully intact.
    const smoke = (await buildCaseEvidence(priya, c.id, NOW))!;
    expect(smoke.complaints.length).toBe(10);
    // Disposed: noise emails are tombstoned, their claims and attachments gone, cached answer and packet removed.
    const [mail] = await db.select().from(t.sourceRecords).where(eq(t.sourceRecords.externalId, "<noise-01@mail.riversidehouse.example>"));
    expect(mail).toMatchObject({ lifecycle: "disposed", title: "[disposed]" });
    expect(mail.rawText).not.toContain("thumping");
    expect(mail.contentHash).toHaveLength(64); // identity and hash survive for the audit trail
    const [{ n: claimsLeft }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.claims).where(eq(t.claims.sourceRecordId, mail.id));
    expect(claimsLeft).toBe(0);
    expect(await db.select().from(t.blobs).where(eq(t.blobs.sourceRecordId, mail.id))).toHaveLength(0);
    expect(await db.select().from(t.reports).where(eq(t.reports.id, report.id))).toHaveLength(0);
    const turns = await db.select().from(t.conversationTurns).where(sql`${t.conversationTurns.answer}::text like ${"%" + mail.id + "%"}`);
    expect(turns).toHaveLength(0);
    const after = (await ask(priya, { question: "What do we know about the noise complaints from 5E about 6E?" }, { now: NOW })).answer;
    expect(after.facts.find((f) => f.key === "complaints")?.n).toBe(3); // the two emailed reports are gone, desk reports remain
    expect(JSON.stringify(after)).not.toContain("recording I made");
  });

  it("releasing a hold is an admin action; a second proposal then matches the released records", async () => {
    const o = await getPrivacyOverview(marcus);
    const hold = o.holds.find((h) => !h.h.releasedAt)!;
    await expect(releaseLegalHold(priya, hold.h.id)).rejects.toThrow(/Not permitted/);
    await releaseLegalHold(marcus, hold.h.id);
    const req = await proposeLifecycle(marcus, { action: "archive", recordClass: "confidential_case", olderThan: new Date("2026-12-01T00:00:00Z") });
    expect(req.heldCount).toBe(0);
    expect(req.matchedCount).toBeGreaterThanOrEqual(9);
    expect((await decideLifecycle(marcus, { id: req.id, decision: "reject" })).status).toBe("rejected");
  });

  it("export contains the organization's records with a hash manifest, and is audited", async () => {
    const db = await getDb();
    const exp = await exportOrganization(marcus);
    const { bytes, meta } = (await readBlob(db, marcus, exp.blobId!))!;
    expect(meta.mediaType).toBe("application/json");
    const data = JSON.parse(new TextDecoder().decode(bytes));
    expect(data.manifest.format).toBe("threadline-export/1");
    expect(data.manifest.counts.source_records).toBe(data.sourceManifest.length);
    expect(data.sourceManifest.every((m: { contentHash: string }) => /^[0-9a-f]{64}$/.test(m.contentHash))).toBe(true);
    const ids = data.tables.audit_log.map((a: { action: string }) => a.action);
    expect(ids).toContain("lifecycle.dispose_executed");
    expect(await verifyAuditChain(db, "org_northbridge")).toMatchObject({ brokenAt: null });
    const last = await db.select().from(t.auditLog).where(and(eq(t.auditLog.orgId, "org_northbridge"), inArray(t.auditLog.action, ["export.created"])));
    expect(last.length).toBe(1);
  });
});
