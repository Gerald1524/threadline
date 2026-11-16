/**
 * Renders the synthetic corpus into the mixed file formats a real building would hand over:
 * a Google Sheets CSV export, an Excel workbook, EML mailbox exports, a work-order CSV,
 * Markdown and PDF policies, and a Google Docs text export.
 *
 * `npm run data:generate` writes these under data/. The seed then imports the files from
 * disk through the same ingestion pipeline used for uploads.
 */
import { TZ, RESIDENTS } from "./reference";
import { CALDER_MAILS, MAILS, type Mail } from "./corpus-mail";
import { FRONT_DESK_ROWS, MOCK_SYNC_BATCHES, TEMP_ROWS, WORK_ORDER_ROWS, routineRows, type LogRow } from "./corpus-logs";
import { DRAFT_DOC, POLICIES, type PolicyDoc } from "./corpus-policies";
import { zonedToUtc } from "../util/time";

export type CorpusFile = { path: string; sourceId: string; content: string | Uint8Array };

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

const usDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
};
const ampm = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const shiftName = (hm: string) => {
  const h = Number(hm.split(":")[0]);
  return h >= 7 && h < 15 ? "Day" : h >= 15 && h < 23 ? "Evening" : "Overnight";
};

export function frontDeskCsv(rows: LogRow[]): string {
  const sorted = [...rows].sort((a, b) => a.logged.localeCompare(b.logged));
  return csv([
    ["Entry ID", "Logged At", "Date", "Time", "Shift", "Staff", "Unit", "Type", "Notes"],
    ...sorted.map((r) => [r.id, `${usDate(r.logged.slice(0, 10))} ${r.logged.slice(11)}:00`, usDate(r.date), ampm(r.time), shiftName(r.time), r.staff, r.unit, r.type, r.notes]),
  ]);
}

async function tempXlsx(rows: LogRow[]): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "StaffRight temp desk";
  wb.created = new Date(Date.UTC(2026, 9, 1));
  wb.modified = new Date(Date.UTC(2026, 10, 15));
  const ws = wb.addWorksheet("Coverage log");
  ws.addRow(["Ref", "Entered", "When", "Name", "Apt", "What happened"]);
  for (const r of [...rows].sort((a, b) => a.logged.localeCompare(b.logged))) {
    const [y, mo, d] = r.logged.slice(0, 10).split("-").map(Number);
    const [hh, mm] = r.logged.slice(11).split(":").map(Number);
    // Excel stores wall-clock time; write it as a UTC-based serial so it displays as entered.
    ws.addRow([r.id, new Date(Date.UTC(y, mo - 1, d, hh, mm)), `${usDate(r.date)} ${ampm(r.time)}`, r.staff, r.unit, r.notes]);
  }
  ws.getColumn(2).numFmt = "m/d/yyyy h:mm";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function workOrdersCsv(): string {
  const f = (s: string) => (s ? `${usDate(s.slice(0, 10))} ${s.slice(11)}` : "");
  return csv([
    ["WO #", "Created", "Created By", "Unit", "Title", "Description", "Status", "Assigned To", "ETA", "Last Updated", "Completed", "Resolution Notes"],
    ...WORK_ORDER_ROWS.map((w) => [w.number, f(w.created), w.createdBy, w.unit, w.title, w.description, w.status, w.assignee, f(w.eta), f(w.updated), f(w.completed), w.resolution]),
  ]);
}

function rfc2822(local: string): string {
  const utc = zonedToUtc(local.slice(0, 10), local.slice(11), TZ);
  const [y, mo, d] = local.slice(0, 10).split("-").map(Number);
  const [hh, mm] = local.slice(11).split(":").map(Number);
  const offMin = Math.round((Date.UTC(y, mo - 1, d, hh, mm) - utc.getTime()) / 60000);
  const sign = offMin < 0 ? "-" : "+";
  const abs = Math.abs(offMin);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wd = days[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${wd}, ${p2(d)} ${months[mo - 1]} ${y} ${p2(hh)}:${p2(mm)}:00 ${sign}${p2(Math.floor(abs / 60))}${p2(abs % 60)}`;
}

const msgId = (id: string) => `<${id}@mail.riversidehouse.example>`;

export function toEml(mail: Mail, all: Mail[]): string {
  const headers = [
    `Message-ID: ${msgId(mail.id)}`,
    `Date: ${rfc2822(mail.date)}`,
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
  ];
  if (mail.replyTo) {
    const chain: string[] = [];
    let cur: Mail | undefined = all.find((x) => x.id === mail.replyTo);
    while (cur) {
      chain.unshift(msgId(cur.id));
      cur = cur.replyTo ? all.find((x) => x.id === cur!.replyTo) : undefined;
    }
    headers.push(`In-Reply-To: ${msgId(mail.replyTo)}`, `References: ${chain.join(" ")}`);
  }
  headers.push("MIME-Version: 1.0");
  const body = mail.body.replace(/\n/g, "\r\n");
  if (!mail.attachments?.length) {
    return [...headers, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: 8bit", "", body, ""].join("\r\n");
  }
  const boundary = `----threadline-${mail.id}`;
  const parts = [`--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: 8bit", "", body, ""];
  for (const a of mail.attachments) {
    const stub = Buffer.from(`SYNTHETIC MEDIA STUB (not a real ${a.mediaType} file)\n${a.note}\n`).toString("base64");
    parts.push(`--${boundary}`, `Content-Type: ${a.mediaType}; name="${a.filename}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${a.filename}"`, "", stub, "");
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

export function policyMarkdown(p: PolicyDoc): string {
  return `---\npolicy: ${p.key}\ntitle: ${p.title}\ncategory: ${p.category}\nversion: ${p.version}\nstatus: ${p.status}\neffective: ${p.effective}\napproved_by: ${p.approvedBy}\n---\n\n# ${p.title}\n\n${p.body}\n`;
}

async function policyPdf(p: PolicyDoc): Promise<Uint8Array> {
  const React = await import("react");
  const { Document, Page, Text, View, renderToBuffer } = await import("@react-pdf/renderer");
  const h = React.createElement;
  const meta = [`Policy: ${p.key}`, `Title: ${p.title}`, `Category: ${p.category}`, `Version: ${p.version}`, `Status: ${p.status}`, `Effective: ${p.effective}`, `Approved by: ${p.approvedBy}`];
  const doc = h(Document, { title: p.title, author: "Northbridge Residential", creationDate: new Date(Date.UTC(2025, 0, 1)) },
    h(Page, { size: "LETTER", style: { padding: 54, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.5 } },
      h(Text, { style: { fontSize: 18, marginBottom: 12, fontFamily: "Helvetica-Bold" } }, p.title),
      h(View, { style: { marginBottom: 14 } }, ...meta.map((line, i) => h(Text, { key: i, style: { fontSize: 9, color: "#444" } }, line))),
      ...p.body.split("\n").map((line, i) => h(Text, { key: `b${i}`, style: { marginBottom: 6 } }, line)),
    ),
  );
  return new Uint8Array(await renderToBuffer(doc));
}

export async function buildCorpus(): Promise<CorpusFile[]> {
  const files: CorpusFile[] = [];
  const current = RESIDENTS.filter((r) => r.propertyId === "prop_riverside" && !r.end).map((r) => ({ name: r.name, unit: r.unit }));
  const R = "riverside";

  files.push({ path: `${R}/shift-logs/front-desk-log.csv`, sourceId: "src_frontdesk_log", content: frontDeskCsv([...FRONT_DESK_ROWS, ...routineRows(current)]) });
  files.push({ path: `${R}/shift-logs/temp-coverage-log.xlsx`, sourceId: "src_temp_log", content: await tempXlsx(TEMP_ROWS) });
  // A damaged copy someone also dropped in the folder: it must fail visibly, not silently.
  files.push({ path: `${R}/shift-logs/temp-coverage-log (copy 2).xlsx`, sourceId: "src_temp_log", content: new TextEncoder().encode("PK\u0003\u0004 this workbook was truncated during upload") });
  files.push({ path: `${R}/work-orders/work-orders-export.csv`, sourceId: "src_workorders", content: workOrdersCsv() });
  for (const mail of MAILS) {
    files.push({ path: `${R}/email/${mail.box}/${mail.date.slice(0, 10)}_${mail.id}.eml`, sourceId: mail.box === "management" ? "src_mgmt_mailbox" : "src_frontdesk_mailbox", content: toEml(mail, MAILS) });
  }
  for (const p of POLICIES) {
    files.push({ path: `${R}/policies/${p.file}`, sourceId: "src_policies", content: p.asPdf ? await policyPdf(p) : policyMarkdown(p) });
  }
  files.push({ path: `${R}/docs/${DRAFT_DOC.file}`, sourceId: "src_docs", content: `${DRAFT_DOC.title}\n\n${DRAFT_DOC.body}\n` });
  MOCK_SYNC_BATCHES.forEach((rows, i) => files.push({ path: `${R}/mock-sync/batch-${i + 1}.csv`, sourceId: "src_mock_sheets", content: frontDeskCsv(rows) }));

  // Second property in the same organization (property-isolation tests).
  files.push({ path: "annex/shift-logs/annex-desk-log.csv", sourceId: "src_annex_log", content: frontDeskCsv([
    { id: "AX-1012-01", logged: "2026-10-12 19:05", date: "2026-10-12", time: "19:00", staff: "Nina Petrov", unit: "3B", type: "Complaint", notes: "Ms. Dunn (3B) called, says cigarette smoke is coming from 2A below. Annex has no porter tonight, logged for the manager." },
    { id: "AX-1013-01", logged: "2026-10-13 09:10", date: "2026-10-13", time: "09:05", staff: "Nina Petrov", unit: "", type: "Package", notes: "UPS dropped 3 pkgs for the Annex, logged." },
  ]) });
  // Unrelated tenant (cross-organization isolation tests).
  for (const mail of CALDER_MAILS) files.push({ path: `calder/email/management/${mail.date.slice(0, 10)}_${mail.id}.eml`, sourceId: "src_calder_mailbox", content: toEml(mail, CALDER_MAILS) });
  return files;
}
