import fs from "node:fs";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { runJob, submitFile, retryJob, IngestBlocked } from "@/lib/ingest/pipeline";
import { frontDeskCsv } from "@/lib/seed/corpus";
import { FRONT_DESK_ROWS } from "@/lib/seed/corpus-logs";
import { setExcludedSensitivity, setSourceStatus } from "@/lib/services/privacy";
import { syncSource } from "@/lib/connectors";
import { ask } from "@/lib/engine/ask";
import { NOW, as, useSeededDb } from "./helpers/db";

const count = async (table: PgTable, where?: SQL) => {
  const db = await getDb("system");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table as typeof t.cases).where(where);
  return n;
};
const enc = (s: string) => new TextEncoder().encode(s);
const P = eq(t.sourceRecords.propertyId, "prop_riverside");

describe("ingestion pipeline", () => {
  useSeededDb();
  const admin = as("u_marcus");

  it("imports the synthetic corpus at the size the brief calls for", async () => {
    expect(await count(t.units, eq(t.units.propertyId, "prop_riverside"))).toBe(84);
    expect(await count(t.sourceRecords, and(P, eq(t.sourceRecords.kind, "shift_note")))).toBeGreaterThanOrEqual(80);
    expect(await count(t.sourceRecords, and(P, eq(t.sourceRecords.kind, "email")))).toBeGreaterThanOrEqual(35);
    expect(await count(t.workOrders, eq(t.workOrders.propertyId, "prop_riverside"))).toBeGreaterThanOrEqual(25);
    expect(await count(t.policies, eq(t.policies.propertyId, "prop_riverside"))).toBeGreaterThanOrEqual(12);
    expect(await count(t.approvals, eq(t.approvals.propertyId, "prop_riverside"))).toBeGreaterThanOrEqual(12);
    expect(await count(t.cases, eq(t.cases.propertyId, "prop_riverside"))).toBeGreaterThanOrEqual(12);
    expect(await count(t.residents, eq(t.residents.propertyId, "prop_riverside"))).toBeGreaterThanOrEqual(25);
    expect(await count(t.blobs, and(eq(t.blobs.propertyId, "prop_riverside"), sql`${t.blobs.sourceRecordId} is not null`))).toBeGreaterThanOrEqual(5);
  });

  it("reads a policy out of a PDF and keeps only one approved version per policy", async () => {
    const db = await getDb("system");
    const [smoke] = await db.select({ v: t.policyVersions, sr: t.sourceRecords }).from(t.policyVersions).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.policyVersions.sourceRecordId)).where(sql`${t.sourceRecords.filename} = 'smoke-free-policy-v3.pdf'`);
    expect(smoke.v.status).toBe("approved");
    expect(smoke.v.body).toContain("A complaint alone is not a finding of a violation");
    const tool = await db.select().from(t.policyVersions).innerJoin(t.policies, eq(t.policies.id, t.policyVersions.policyId)).where(eq(t.policies.key, "tool-lending-installation"));
    expect(tool.map((x) => `${x.policy_versions.version}:${x.policy_versions.status}`).sort()).toEqual(["1:superseded", "2:approved"]);
  });

  it("is idempotent: re-submitting an identical file creates nothing", async () => {
    const before = await count(t.sourceRecords);
    const bytes = new Uint8Array(fs.readFileSync("data/riverside/shift-logs/front-desk-log.csv"));
    const res = await submitFile(admin, { sourceId: "src_frontdesk_log", filename: "front-desk-log.csv", bytes });
    expect(res).toMatchObject({ deduped: true, alreadySucceeded: true });
    expect(await count(t.sourceRecords)).toBe(before);
  });

  it("re-importing the same rows inside a new file changes nothing", async () => {
    const before = { sr: await count(t.sourceRecords), ev: await count(t.events), cases: await count(t.cases), reviews: await count(t.reviewItems) };
    const subset = frontDeskCsv(FRONT_DESK_ROWS.slice(0, 9));
    const { jobId } = await submitFile(admin, { sourceId: "src_frontdesk_log", filename: "front-desk-log-recent.csv", bytes: enc(subset) });
    const job = await runJob(jobId);
    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({ parsed: 9, created: 0, updated: 0, unchanged: 9 });
    expect({ sr: await count(t.sourceRecords), ev: await count(t.events), cases: await count(t.cases), reviews: await count(t.reviewItems) }).toEqual(before);
  });

  it("stores an edited upstream row as a new version and keeps the original intact", async () => {
    const db = await getDb("system");
    const edited = FRONT_DESK_ROWS.filter((r) => r.id === "FD-1029-01").map((r) => ({ ...r, notes: `${r.notes} Adjusted at 2pm.` }));
    const { jobId } = await submitFile(admin, { sourceId: "src_frontdesk_log", filename: "front-desk-log-edit.csv", bytes: enc(frontDeskCsv(edited)) });
    expect((await runJob(jobId)).result).toMatchObject({ updated: 1, created: 0 });
    const versions = await db.select().from(t.sourceRecords).where(and(P, eq(t.sourceRecords.externalId, "FD-1029-01"))).orderBy(t.sourceRecords.version);
    expect(versions.map((v) => [v.version, v.isCurrent])).toEqual([[1, false], [2, true]]);
    expect(versions[0].rawText).not.toContain("Adjusted at 2pm");
    expect(versions[1].supersedesId).toBe(versions[0].id);
    const evs = await db.select().from(t.events).where(eq(t.events.sourceRecordId, versions[0].id));
    expect(evs.every((e) => e.status === "superseded")).toBe(true);
  });

  it("refuses, at the database, to alter a preserved original or the audit log", async () => {
    const db = await getDb("system");
    const [sr] = await db.select().from(t.sourceRecords).where(and(P, eq(t.sourceRecords.externalId, "FD-1005-07")));
    await expect(db.update(t.sourceRecords).set({ rawText: "tampered" }).where(eq(t.sourceRecords.id, sr.id))).rejects.toThrow();
    await expect(db.delete(t.sourceRecords).where(eq(t.sourceRecords.id, sr.id))).rejects.toThrow();
    await expect(db.update(t.auditLog).set({ action: "tampered" }).where(eq(t.auditLog.orgId, "org_northbridge"))).rejects.toThrow();
    await expect(db.delete(t.auditLog).where(eq(t.auditLog.orgId, "org_northbridge"))).rejects.toThrow();
  });

  it("keeps a failed import visible and retryable", async () => {
    const db = await getDb("system");
    const [job] = await db.select().from(t.ingestJobs).where(eq(t.ingestJobs.status, "failed"));
    expect(job.filename).toBe("temp-coverage-log (copy 2).xlsx");
    expect(job.error).toMatch(/Could not open workbook/);
    const again = await retryJob(admin, job.id);
    expect(again.status).toBe("failed");
    expect(again.attempts).toBe(job.attempts + 1);
    const [src] = await db.select().from(t.dataSources).where(eq(t.dataSources.id, "src_temp_log"));
    expect(src.lastError).toContain("copy 2");
  });

  it("rejects unsupported and malformed files with a clear error instead of guessing", async () => {
    const bad = await submitFile(admin, { sourceId: "src_frontdesk_log", filename: "notes.docx", bytes: enc("x") });
    expect((await runJob(bad.jobId)).error).toMatch(/Unsupported file type/);
    const cols = await submitFile(admin, { sourceId: "src_frontdesk_log", filename: "wrong-columns.csv", bytes: enc("A,B\n1,2\n") });
    expect((await runJob(cols.jobId)).error).toMatch(/Unrecognized columns/);
  });

  it("flags instruction-like text, unknown senders, health information and uncertain identity for human review", async () => {
    const db = await getDb("system");
    const items = await db.select({ type: t.reviewItems.type, ext: t.sourceRecords.externalId, status: t.reviewItems.status }).from(t.reviewItems).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.reviewItems.sourceRecordId)).where(eq(t.reviewItems.propertyId, "prop_riverside"));
    const has = (type: string, ext: string) => items.some((i) => i.type === type && i.ext === ext);
    expect(has("suspected_injection", "<smoke-11@mail.riversidehouse.example>")).toBe(true);
    expect(has("ambiguous_identity", "<smoke-11@mail.riversidehouse.example>")).toBe(true);
    expect(has("sensitive_content", "<smoke-01@mail.riversidehouse.example>")).toBe(true);
    expect(has("ambiguous_identity", "TC-0049")).toBe(true);
    expect(has("tentative_link", "FD-1030-04")).toBe(true);
    const [inj] = await db.select().from(t.sourceRecords).where(eq(t.sourceRecords.externalId, "<smoke-11@mail.riversidehouse.example>"));
    expect(inj.injectionFlag).toBe(true);
    // A report naming a resident but no apartment is held: no unit, no case link.
    const [ev] = await db.select({ e: t.events }).from(t.events).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.events.sourceRecordId)).where(eq(t.sourceRecords.externalId, "TC-0049"));
    expect(ev.e.unitId).toBeNull();
    expect(await count(t.caseEvents, eq(t.caseEvents.eventId, ev.e.id))).toBe(0);
  });

  it("keeps event time, record time and shift coverage separate", async () => {
    const db = await getDb("system");
    const rows = await db.select({ e: t.events }).from(t.events).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.events.sourceRecordId)).where(and(eq(t.sourceRecords.externalId, "FD-1113-01"), eq(t.events.status, "active"))).orderBy(t.events.occurredAt);
    expect(rows.map((r) => r.e.type)).toEqual(["complaint_report", "investigation"]);
    expect(rows[0].e.occurredAt.toISOString()).toBe("2026-11-13T04:30:00.000Z"); // Nov 12, 11:30 PM EST
    expect(rows[0].e.recordedAt!.toISOString()).toBe("2026-11-13T06:15:00.000Z"); // written 1:15 AM
    expect(rows[0].e.lateEntry).toBe(true);
    expect(rows[0].e.onDutyUserId).toBe("u_dmitri");
    expect(rows[1].e.investigatorUserId).toBe("u_dmitri");
    const [oct5] = await db.select({ e: t.events }).from(t.events).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.events.sourceRecordId)).where(eq(t.sourceRecords.externalId, "FD-1005-08"));
    expect([oct5.e.recorderUserId, oct5.e.investigatorUserId, oct5.e.onDutyUserId]).toEqual(["u_michael", "u_carlos", "u_michael"]);
    expect(oct5.e.occurredAt.toISOString()).toBe("2026-10-05T19:54:00.000Z"); // 3:54 PM EDT
  });

  it("incremental sync adds only new records and the answer reflects them", async () => {
    const mgr = as("u_priya");
    const first = await syncSource(mgr, "src_mock_sheets");
    expect(first.jobs[0].result).toMatchObject({ created: 2 });
    const second = await syncSource(mgr, "src_mock_sheets");
    expect(second.jobs[0].result).toMatchObject({ created: 1 });
    const third = await syncSource(mgr, "src_mock_sheets");
    expect(third).toMatchObject({ files: 0, upToDate: true });
    const { answer } = await ask(mgr, { question: "What do we know about the smoke complaints about 12B?" }, { now: NOW });
    expect(answer.facts.find((f) => f.key === "complaints")?.n).toBe(11);
    expect(answer.sources.some((s) => s.externalId === "FD-1116-03")).toBe(true);
  });

  it("a paused or disconnected source accepts nothing, and existing records stay", async () => {
    const before = await count(t.sourceRecords, eq(t.sourceRecords.sourceId, "src_frontdesk_mailbox"));
    await setSourceStatus(admin, { sourceId: "src_frontdesk_mailbox", status: "disconnected" });
    await expect(submitFile(admin, { sourceId: "src_frontdesk_mailbox", filename: "x.eml", bytes: enc("x") })).rejects.toThrow(IngestBlocked);
    expect(await count(t.sourceRecords, eq(t.sourceRecords.sourceId, "src_frontdesk_mailbox"))).toBe(before);
    await setSourceStatus(admin, { sourceId: "src_frontdesk_mailbox", status: "active" });
  });

  it("does not store records in a sensitivity class the organization has excluded", async () => {
    await setExcludedSensitivity(admin, ["highly_sensitive"]);
    const eml = ["Message-ID: <excluded-1@mail.riversidehouse.example>", "Date: Mon, 16 Nov 2026 09:00:00 -0500", "From: Ben Okafor <b.okafor@example.net>", "To: frontdesk@riversidehouse.example", "Subject: Documents for my file", "", "Here is my passport number and bank account for the lease file.", ""].join("\r\n");
    const { jobId } = await submitFile(admin, { sourceId: "src_frontdesk_mailbox", filename: "excluded.eml", bytes: enc(eml) });
    expect((await runJob(jobId)).result).toMatchObject({ excluded: 1, created: 0 });
    expect(await count(t.sourceRecords, eq(t.sourceRecords.externalId, "<excluded-1@mail.riversidehouse.example>"))).toBe(0);
    await setExcludedSensitivity(admin, []);
  });
});
