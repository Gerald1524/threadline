/**
 * File parsers: turn an uploaded/exported file into normalized ParsedRecords while keeping
 * every original field. Parsers do not interpret meaning — that is extract.ts.
 */
import { parse as parseCsv } from "csv-parse/sync";
import { zonedToUtc } from "../util/time";

export type ParsedAttachment = { filename: string; mediaType: string; bytes: Uint8Array };

export type ParsedRecord = {
  kind: "shift_note" | "email" | "work_order" | "policy_doc" | "document";
  externalId: string;
  locator: string;
  title: string;
  text: string;
  json: Record<string, unknown>;
  author?: string;
  occurredAt?: Date;
  recordedAt?: Date;
  receivedAt?: Date;
  attachments?: ParsedAttachment[];
};

export class ParseError extends Error {}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

const ALIASES: Record<string, string[]> = {
  entryId: ["entry id", "ref", "id", "entry"],
  loggedAt: ["logged at", "entered", "timestamp", "logged"],
  date: ["date"],
  time: ["time"],
  when: ["when", "date time", "event time"],
  shift: ["shift", "covering"],
  staff: ["staff", "name", "concierge", "employee"],
  unit: ["unit", "apt", "apartment"],
  type: ["type", "category"],
  notes: ["notes", "what happened", "details", "entry text", "description"],
};

function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(ALIASES)) if (names.includes(n) && out[field] === undefined) out[field] = i;
  });
  return out;
}

/** Accepts "10/5/2026", "10/5/2026 15:47:00", "10/5/2026 3:45 PM", "2026-10-05 15:47". */
export function parseLocalDateTime(input: string | undefined): { date: string; time?: string } | null {
  if (!input) return null;
  const s = input.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm]?)?)?$/);
  let y: number, mo: number, d: number, hh: number | undefined, mm: number | undefined, ap: string | undefined;
  if (m) [y, mo, d, hh, mm, ap] = [Number(m[3]), Number(m[1]), Number(m[2]), m[4] ? Number(m[4]) : undefined, m[5] ? Number(m[5]) : undefined, m[6]];
  else {
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/);
    if (!m) return null;
    [y, mo, d, hh, mm] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : undefined, m[5] ? Number(m[5]) : undefined];
  }
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (hh === undefined || mm === undefined) return { date };
  if (ap) {
    const pm = ap.toLowerCase().startsWith("p");
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  return { date, time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

export function parseClock(input: string | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm]?)?$/);
  if (!m) return null;
  let hh = Number(m[1]);
  if (m[3]) {
    const pm = m[3].toLowerCase().startsWith("p");
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

type Cell = string | Date | null | undefined;
const cellText = (c: Cell): string => {
  if (c == null) return "";
  if (c instanceof Date) {
    // Spreadsheet date cells hold wall-clock time; read the UTC fields as local values.
    const p = (n: number) => String(n).padStart(2, "0");
    return `${c.getUTCFullYear()}-${p(c.getUTCMonth() + 1)}-${p(c.getUTCDate())} ${p(c.getUTCHours())}:${p(c.getUTCMinutes())}`;
  }
  return String(c).trim();
};

function tableToRecords(filename: string, headers: string[], rows: Cell[][], tz: string): ParsedRecord[] {
  const hn = headers.map(norm);
  if (hn.includes("wo #") || hn.includes("work order")) return workOrderRecords(filename, headers, rows, tz);
  const map = mapHeaders(headers);
  if (map.notes === undefined || map.entryId === undefined) throw new ParseError(`Unrecognized columns in ${filename}: expected an entry id column and a notes column, found [${headers.join(", ")}]`);
  const out: ParsedRecord[] = [];
  rows.forEach((cells, i) => {
    const get = (f: string) => (map[f] === undefined ? "" : cellText(cells[map[f]]));
    const notes = get("notes");
    const entryId = get("entryId");
    if (!notes && !entryId) return;
    if (!entryId) throw new ParseError(`${filename} row ${i + 2}: missing entry id`);
    const logged = parseLocalDateTime(get("loggedAt"));
    let when = parseLocalDateTime(get("when"));
    if (!when) {
      const d = parseLocalDateTime(get("date"));
      const t = parseClock(get("time"));
      if (d) when = { date: d.date, time: t ?? undefined };
    }
    const recordedAt = logged?.time ? zonedToUtc(logged.date, logged.time, tz) : undefined;
    const occurredAt = when?.time ? zonedToUtc(when.date, when.time, tz) : recordedAt;
    const columns: Record<string, string> = {};
    headers.forEach((h, j) => (columns[h] = cellText(cells[j])));
    out.push({
      kind: "shift_note", externalId: entryId, locator: `${filename}#row=${i + 2}`,
      title: `Shift log ${entryId}`, text: notes,
      json: { columns, entryId, staff: get("staff"), unit: get("unit"), type: get("type"), shift: get("shift"), eventLocal: when ?? null, loggedLocal: logged ?? null },
      author: get("staff") || undefined, occurredAt, recordedAt,
    });
  });
  return out;
}

function workOrderRecords(filename: string, headers: string[], rows: Cell[][], tz: string): ParsedRecord[] {
  const idx = (name: string) => headers.findIndex((h) => norm(h) === name);
  const col = { number: idx("wo #"), created: idx("created"), createdBy: idx("created by"), unit: idx("unit"), title: idx("title"), description: idx("description"), status: idx("status"), assignee: idx("assigned to"), eta: idx("eta"), updated: idx("last updated"), completed: idx("completed"), resolution: idx("resolution notes") };
  const at = (v: string) => {
    const p = parseLocalDateTime(v);
    return p?.time ? zonedToUtc(p.date, p.time, tz) : undefined;
  };
  return rows.flatMap((cells, i) => {
    const get = (k: keyof typeof col) => (col[k] < 0 ? "" : cellText(cells[col[k]]));
    const number = get("number");
    if (!number) return [];
    const columns: Record<string, string> = {};
    headers.forEach((h, j) => (columns[h] = cellText(cells[j])));
    const text = [get("title"), get("description"), get("resolution") && `Resolution: ${get("resolution")}`].filter(Boolean).join("\n");
    return [{
      kind: "work_order" as const, externalId: number, locator: `${filename}#row=${i + 2}`, title: `${number} ${get("title")}`, text,
      json: { columns, number, unit: get("unit"), title: get("title"), description: get("description"), status: get("status"), assignee: get("assignee"), createdBy: get("createdBy"), resolution: get("resolution"), createdAt: at(get("created"))?.toISOString() ?? null, updatedAt: at(get("updated"))?.toISOString() ?? null, completedAt: at(get("completed"))?.toISOString() ?? null, eta: at(get("eta"))?.toISOString() ?? null },
      author: get("createdBy") || undefined, occurredAt: at(get("completed")) ?? at(get("updated")) ?? at(get("created")), recordedAt: at(get("updated")) ?? at(get("created")),
    }];
  });
}

async function parseXlsx(filename: string, bytes: Uint8Array, tz: string): Promise<ParsedRecord[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch (e) {
    throw new ParseError(`Could not open workbook ${filename}: ${(e as Error).message}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ParseError(`Workbook ${filename} has no sheets`);
  const table: Cell[][] = [];
  ws.eachRow((row) => {
    const vals = (row.values as unknown[]).slice(1).map((v) => {
      if (v instanceof Date) return v;
      if (v && typeof v === "object" && "text" in (v as Record<string, unknown>)) return String((v as { text: unknown }).text);
      if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) return String((v as { result: unknown }).result);
      return v == null ? "" : String(v);
    });
    table.push(vals);
  });
  if (table.length < 1) throw new ParseError(`Workbook ${filename} is empty`);
  return tableToRecords(filename, table[0].map(cellText), table.slice(1), tz);
}

async function parseEml(filename: string, bytes: Uint8Array): Promise<ParsedRecord[]> {
  const PostalMime = (await import("postal-mime")).default;
  const mail = await PostalMime.parse(bytes);
  if (!mail.messageId || !mail.from?.address) throw new ParseError(`${filename} is not a valid email message (missing Message-ID or From)`);
  const date = mail.date ? new Date(mail.date) : undefined;
  const text = (mail.text ?? "").replace(/\r\n/g, "\n").trim();
  const to = (mail.to ?? []).map((a) => ({ name: a.name ?? "", address: (a.address ?? "").toLowerCase() }));
  const references = (mail.references ?? "").split(/\s+/).filter(Boolean);
  return [{
    kind: "email", externalId: mail.messageId, locator: `${filename}#message-id=${mail.messageId}`, title: mail.subject ?? "(no subject)", text,
    json: {
      messageId: mail.messageId, inReplyTo: mail.inReplyTo ?? null, references, subject: mail.subject ?? "",
      from: { name: mail.from.name ?? "", address: mail.from.address.toLowerCase() }, to, date: date?.toISOString() ?? null,
      attachments: (mail.attachments ?? []).map((a) => ({ filename: a.filename ?? "attachment", mediaType: a.mimeType })),
    },
    author: mail.from.name || mail.from.address, occurredAt: date, receivedAt: date, recordedAt: date,
    attachments: (mail.attachments ?? []).map((a) => ({ filename: a.filename ?? "attachment", mediaType: a.mimeType, bytes: typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content as ArrayBuffer) })),
  }];
}

/** Policy metadata appears as YAML-style front matter (Markdown) or labelled lines (PDF). */
function policyMeta(text: string) {
  const pick = (label: string) => text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "im"))?.[1];
  const key = pick("policy");
  const version = pick("version");
  const status = pick("status")?.toLowerCase();
  if (!key || !version || !status) return null;
  return { key, title: pick("title") ?? key, category: pick("category") ?? "general", version: Number(version), status, effective: pick("effective") ?? null, approvedBy: pick("approved[_ ]by") ?? null };
}

function textDocument(filename: string, raw: string): ParsedRecord[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const meta = policyMeta(text.slice(0, 1200));
  if (meta) {
    const body = text.replace(/^---[\s\S]*?---\s*/, "").replace(/^(policy|title|category|version|status|effective|approved[_ ]by)\s*:.*$/gim, "").trim();
    return [{ kind: "policy_doc", externalId: `${meta.key}@v${meta.version}`, locator: filename, title: `${meta.title} (v${meta.version})`, text: body, json: { ...meta, filename } }];
  }
  const firstLine = text.split("\n")[0]?.replace(/^#\s*/, "").trim() || filename;
  const draft = /\b(draft|not approved|working notes)\b/i.test(text.slice(0, 400));
  return [{ kind: "document", externalId: filename, locator: filename, title: firstLine, text, json: { filename, draft } }];
}

async function parsePdf(filename: string, bytes: Uint8Array): Promise<ParsedRecord[]> {
  const { extractText } = await import("unpdf");
  let pages: string[];
  try {
    const res = await extractText(new Uint8Array(bytes), { mergePages: false });
    pages = res.text as unknown as string[];
  } catch (e) {
    throw new ParseError(`Could not read PDF ${filename}: ${(e as Error).message}`);
  }
  const text = pages.join("\n").trim();
  if (!text) throw new ParseError(`PDF ${filename} has no extractable text (scanned image?). OCR is not enabled.`);
  return textDocument(filename, text);
}

export async function parseFile(filename: string, bytes: Uint8Array, tz: string): Promise<ParsedRecord[]> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const decode = () => new TextDecoder("utf-8").decode(bytes);
  switch (ext) {
    case "csv": {
      let rows: string[][];
      try {
        rows = parseCsv(decode(), { skip_empty_lines: true, relax_column_count: true, bom: true });
      } catch (e) {
        throw new ParseError(`Could not parse CSV ${filename}: ${(e as Error).message}`);
      }
      if (rows.length < 1) throw new ParseError(`${filename} is empty`);
      return tableToRecords(filename, rows[0], rows.slice(1), tz);
    }
    case "xlsx":
      return parseXlsx(filename, bytes, tz);
    case "eml":
      return parseEml(filename, bytes);
    case "pdf":
      return parsePdf(filename, bytes);
    case "md":
    case "txt":
      return textDocument(filename, decode());
    default:
      throw new ParseError(`Unsupported file type ".${ext}". Supported: csv, xlsx, eml, pdf, md, txt.`);
  }
}
