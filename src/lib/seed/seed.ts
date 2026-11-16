/**
 * Seeds the synthetic tenants: reference data, then the corpus files through the real
 * ingestion pipeline, then a history of human decisions made through the real services.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { ROLE_CAPS, type AccessContext } from "../access";
import { hashPassword } from "../auth/password";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { runJob, submitFile } from "../ingest/pipeline";
import { zonedToUtc } from "../util/time";
import { DEMO_PASSWORD, ORGS, PROPERTIES, RESIDENTS, SHIFT_DEFS, TZ, USERS, buildRoster, unitId } from "./reference";
import { seedOperations } from "./operations";

const at = (local: string) => zonedToUtc(local.slice(0, 10), local.slice(11), TZ);

export function ctxFor(userId: string, propertyId = "prop_riverside"): AccessContext {
  const u = USERS.find((x) => x.id === userId)!;
  const p = PROPERTIES.find((x) => x.id === propertyId)!;
  if (!ROLE_CAPS[u.role]) throw new Error(`bad role for ${userId}`);
  return { userId: u.id, userName: u.name, orgId: u.orgId, propertyId: p.id, propertyName: p.name, timezone: TZ, role: u.role, employmentType: u.employment };
}

const sysCtx = (propertyId: string): AccessContext => {
  const p = PROPERTIES.find((x) => x.id === propertyId)!;
  return { userId: "system:ingest", userName: "Threadline ingestion", orgId: p.orgId, propertyId: p.id, propertyName: p.name, timezone: TZ, role: "regional_admin", employmentType: "system" };
};

type SourceSeed = Partial<typeof t.dataSources.$inferInsert> & { id: string; propertyId: string; kind: string; name: string };
const SOURCES: SourceSeed[] = [
  { id: "src_frontdesk_log", propertyId: "prop_riverside", kind: "csv", name: "Front desk shift log (Google Sheets export)", description: "Shared sheet kept by permanent front-desk staff. Imported as CSV.", scopes: ["One spreadsheet: \"Riverside Front Desk Log\""] },
  { id: "src_temp_log", propertyId: "prop_riverside", kind: "xlsx", name: "Temp coverage log (Excel workbook)", description: "Workbook kept by agency temp staff. Different columns from the main log.", scopes: ["One workbook: \"temp-coverage-log.xlsx\""] },
  { id: "src_mgmt_mailbox", propertyId: "prop_riverside", kind: "eml", name: "Management mailbox export", description: "management@riversidehouse.example, exported as EML. Shared building mailbox only; no personal mailboxes.", defaultVisibility: "management", scopes: ["Shared mailbox management@ (export)"], coverageNote: "Export taken Nov 13, 2026. Mail received after the export is not in Threadline until the next import." },
  { id: "src_frontdesk_mailbox", propertyId: "prop_riverside", kind: "eml", name: "Front desk shared mailbox export", description: "frontdesk@riversidehouse.example, exported as EML.", scopes: ["Shared mailbox frontdesk@ (export)"] },
  { id: "src_workorders", propertyId: "prop_riverside", kind: "csv", name: "Work order export", description: "CSV export from the maintenance tracker.", scopes: ["Work order export file"] },
  { id: "src_policies", propertyId: "prop_riverside", kind: "docs_export", name: "Policy binder", description: "Approved building policies as Markdown and PDF.", scopes: ["Folder: Policies/Approved"] },
  { id: "src_docs", propertyId: "prop_riverside", kind: "docs_export", name: "Google Docs exports (working documents)", description: "Text exports of working documents. Not authoritative policy.", defaultVisibility: "management", scopes: ["Folder: Management/Working notes"] },
  { id: "src_inapp_riverside", propertyId: "prop_riverside", kind: "manual", name: "Threadline entries and workflow", mode: "in_app", description: "Entries typed or dictated in Threadline, and actions taken in the app.", scopes: ["Created in Threadline"] },
  { id: "src_mock_sheets", propertyId: "prop_riverside", kind: "google_workspace", name: "Front desk log — live sync (simulated connector)", mode: "mock_connector", description: "Simulates an incremental Google Sheets sync using local fixture batches. No Google account is contacted.", scopes: ["spreadsheets.readonly on one spreadsheet (simulated)"] },
  { id: "src_m365", propertyId: "prop_riverside", kind: "m365", name: "Microsoft 365 shared mailbox (Graph delta sync)", mode: "planned_connector", status: "planned", description: "Not connected. Requires tenant admin consent and security review.", scopes: ["Mail.Read on one shared mailbox (application access policy)"] },
  { id: "src_gws", propertyId: "prop_riverside", kind: "google_workspace", name: "Google Workspace (Drive changes, Sheets, Gmail)", mode: "planned_connector", status: "planned", description: "Not connected. Gmail scopes are restricted and need Google verification.", scopes: ["drive.file", "spreadsheets.readonly", "gmail.readonly (restricted scope)"] },
  { id: "src_platform", propertyId: "prop_riverside", kind: "property_platform", name: "Property platform export (BuildingLink / Yardi / AppFolio)", mode: "planned_connector", status: "planned", description: "Adapter target. Only via a supported API or an authorized export.", scopes: ["Authorized export files"] },
  { id: "src_annex_log", propertyId: "prop_annex", kind: "csv", name: "Annex desk log", scopes: ["One spreadsheet"] },
  { id: "src_inapp_annex", propertyId: "prop_annex", kind: "manual", name: "Threadline entries and workflow", mode: "in_app" },
  { id: "src_calder_mailbox", propertyId: "prop_calder", kind: "eml", name: "Calder Court management mailbox export", defaultVisibility: "management" },
  { id: "src_inapp_calder", propertyId: "prop_calder", kind: "manual", name: "Threadline entries and workflow", mode: "in_app" },
];

export const DEFAULT_RETENTION: t.RetentionPolicy = {
  public_policy: { days: null }, internal_ops: { days: 1095 }, employee_pi: { days: 1095 }, resident_pi: { days: 2555 }, confidential_case: { days: 2555 }, highly_sensitive: { days: 365 },
};
export const DEFAULT_PROVIDER_POLICY: t.ProviderPolicy = {
  reasoning: { provider: "anthropic", allowedSensitivity: ["public_policy", "internal_ops", "employee_pi", "resident_pi", "confidential_case"] },
  classification: { provider: "rules", allowedSensitivity: ["public_policy", "internal_ops", "employee_pi", "resident_pi", "confidential_case", "highly_sensitive"] },
  transcription: { provider: "browser", allowedSensitivity: ["public_policy", "internal_ops", "employee_pi", "resident_pi", "confidential_case"] },
  speech: { provider: "browser", allowedSensitivity: ["public_policy", "internal_ops", "employee_pi", "resident_pi", "confidential_case"] },
  embeddings: { provider: "none", allowedSensitivity: [] },
};

export async function seedReference() {
  const db = await getDb();
  const pw = hashPassword(DEMO_PASSWORD, "threadline-demo-salt");
  await db.transaction(async (tx) => {
    await tx.insert(t.organizations).values(ORGS);
    for (const p of PROPERTIES) {
      const labels: { label: string; floor: number }[] = [];
      for (let f = p.floors[0]; f <= p.floors[1]; f++) for (const l of p.lines) labels.push({ label: `${f}${l}`, floor: f });
      await tx.insert(t.properties).values({ id: p.id, orgId: p.orgId, name: p.name, address: p.address, timezone: TZ, unitCount: labels.length });
      await tx.insert(t.units).values(labels.map((u) => ({ id: unitId(p.id, u.label), orgId: p.orgId, propertyId: p.id, label: u.label, floor: u.floor })));
    }
    for (const r of RESIDENTS) {
      const p = PROPERTIES.find((x) => x.id === r.propertyId)!;
      await tx.insert(t.residents).values({ id: r.id, orgId: p.orgId, propertyId: p.id, fullName: r.name, email: r.email, phone: `212-555-01${String(RESIDENTS.indexOf(r)).padStart(2, "0")}` });
      await tx.insert(t.residencies).values({ id: `stay_${r.id}`, orgId: p.orgId, propertyId: p.id, residentId: r.id, unitId: unitId(p.id, r.unit), startDate: r.start, endDate: r.end ?? null });
    }
    await tx.insert(t.users).values(USERS.map((u) => ({ id: u.id, orgId: u.orgId, email: u.email, fullName: u.name, jobTitle: u.title, employmentType: u.employment, passwordHash: pw })));
    await tx.insert(t.memberships).values(USERS.map((u) => ({ id: `mem_${u.id}`, orgId: u.orgId, userId: u.id, propertyId: u.propertyId, role: u.role })));
    await tx.insert(t.shiftDefinitions).values(SHIFT_DEFS.map((s) => ({ id: s.id, orgId: "org_northbridge", propertyId: "prop_riverside", name: s.name, roleScope: s.roleScope, startTime: s.start, endTime: s.end })));
    const roster = buildRoster();
    for (let i = 0; i < roster.length; i += 100) await tx.insert(t.shiftAssignments).values(roster.slice(i, i + 100).map((a) => ({ ...a, orgId: "org_northbridge", propertyId: "prop_riverside" })));
    await tx.insert(t.dataSources).values(SOURCES.map((s) => ({ ...s, orgId: PROPERTIES.find((p) => p.id === s.propertyId)!.orgId })));
    await tx.insert(t.orgSettings).values(ORGS.map((o) => ({ orgId: o.id, retention: DEFAULT_RETENTION, providerPolicy: DEFAULT_PROVIDER_POLICY })));
  });
}

const FOLDER_ORDER = ["shift-logs", "work-orders", "email", "policies", "docs"];

/** Import every corpus file from disk through submitFile/runJob, as an upload would be. */
export async function seedCorpus(dataRoot = path.resolve("data")) {
  const db = await getDb();
  const manifest: { path: string; sourceId: string }[] = JSON.parse(fs.readFileSync(path.join(dataRoot, "manifest.json"), "utf8"));
  const rank = (p: string) => FOLDER_ORDER.findIndex((f) => p.includes(`/${f}/`));
  const files = manifest.filter((f) => !f.path.includes("/mock-sync/")).sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  const sources = new Map((await db.select().from(t.dataSources)).map((s) => [s.id, s]));
  const summary = { files: 0, failed: 0 };
  for (const f of files) {
    const src = sources.get(f.sourceId)!;
    const bytes = new Uint8Array(fs.readFileSync(path.join(dataRoot, f.path)));
    const { jobId } = await submitFile(sysCtx(src.propertyId), { sourceId: src.id, filename: path.basename(f.path), bytes });
    const job = await runJob(jobId);
    summary.files++;
    if (job.status !== "succeeded") summary.failed++;
  }
  // The management mailbox export was taken on Nov 13; record that as the edge of its coverage.
  await db.update(t.dataSources).set({ lastSyncAt: at("2026-11-13 08:00"), lastSuccessAt: at("2026-11-13 08:00"), coverageThrough: at("2026-11-13 08:00") }).where(eq(t.dataSources.id, "src_mgmt_mailbox"));
  return summary;
}

export async function isSeeded() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.organizations);
  return n > 0;
}

export async function seedAll(opts: { dataRoot?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  await seedReference();
  log("reference data inserted");
  const s = await seedCorpus(opts.dataRoot);
  log(`imported ${s.files} files (${s.failed} failed as intended)`);
  await seedOperations();
  log("workflow history applied");
  return s;
}

