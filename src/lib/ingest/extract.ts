/**
 * Structured extraction: ParsedRecord -> event drafts with sentence-level claims.
 *
 * This is the deterministic rules extractor. It never invents content: every claim is a
 * verbatim sentence from the source, tagged with who is asserting it. Anything the rules are
 * unsure about becomes a review flag rather than a silent guess.
 */
import { levenshtein, truncate } from "../util/core";
import { addDays, localParts, zonedToUtc } from "../util/time";
import { COMPLAINT_CATEGORIES, CUES, REQUEST_CATEGORIES, categorize, isCaseCategory, outcomeOf, screenContent } from "./lexicon";
import type { ParsedRecord } from "./parsers";

export type Directory = {
  orgId: string;
  propertyId: string;
  timezone: string;
  units: Map<string, { id: string; floor: number }>;
  residents: { id: string; fullName: string; surname: string; email: string | null; stays: { unitId: string; unitLabel: string; start: string; end: string | null }[] }[];
  staff: { id: string; fullName: string; firstName: string; email: string }[];
  staffDomains: string[];
};

export type ClaimDraft = { classification: "allegation" | "staff_observation" | "documented_action" | "statement" | "note"; outcome?: string; text: string; observerUserId?: string };

export type EventDraft = {
  key: string;
  type: string;
  category: string;
  channel: string;
  direction: "inbound" | "outbound" | "internal";
  summary: string;
  unitId?: string;
  reporterUnitId?: string;
  reporterResidentId?: string;
  reporterName?: string;
  mentionedUnitIds: string[];
  floors: number[];
  occurredAt: Date;
  recordedAt?: Date;
  receivedAt?: Date;
  lateEntry: boolean;
  recorderUserId?: string;
  investigatorUserId?: string;
  assigneeUserId?: string;
  threadKey?: string;
  externalRef?: string;
  inReplyToRef?: string;
  claims: ClaimDraft[];
  confidence: number;
  hasAttachment: boolean;
  unknownSender?: boolean;
};

export type ReviewDraft = { type: string; title: string; detail: string; eventKey?: string };

export type Extraction = { events: EventDraft[]; reviews: ReviewDraft[]; sensitivity: string; visibility: "staff" | "management" | "restricted"; injection: boolean };

// ---------------------------------------------------------------- helpers

const ABBR = /\b(Mr|Mrs|Ms|Dr|approx|ref|fl|apt|No)\./g;

export function splitSentences(text: string): string[] {
  const protectedText = text.replace(ABBR, "$1§");
  return protectedText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/§/g, ".").trim())
    .filter((s) => s.length > 0);
}

const UNIT_RE = /\b(\d{1,2})-?([A-F])\b/g;

export function findUnits(text: string, dir: Directory): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(UNIT_RE)) {
    const label = `${Number(m[1])}${m[2]}`;
    if (dir.units.has(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

export function findFloors(text: string): number[] {
  const floors = new Set<number>();
  for (const m of text.matchAll(/\bbetween (\d{1,2}) and (\d{1,2})\b/gi)) [m[1], m[2]].forEach((f) => floors.add(Number(f)));
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)? (?:fl\b|floor\b)/gi)) floors.add(Number(m[1]));
  return [...floors];
}

/** Time of day written inside free text ("3:54pm", "9:20p", "11:40pm"). */
export function findClock(sentence: string): string | null {
  const m = sentence.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm|a|p)\b/i);
  if (!m) return null;
  let hh = Number(m[1]);
  if (hh > 12) return null;
  const pm = m[3].toLowerCase().startsWith("p");
  if (pm && hh < 12) hh += 12;
  if (!pm && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${m[2] ?? "00"}`;
}

const occupantAt = (dir: Directory, unitId: string, isoDate: string) =>
  dir.residents.find((r) => r.stays.some((s) => s.unitId === unitId && s.start <= isoDate && (!s.end || s.end >= isoDate)));

/** Match a surname written in a note against the resident directory, tolerating one typo. */
function matchResident(dir: Directory, text: string, preferUnitIds: string[], isoDate: string): { id: string; fullName: string; exact: boolean; unitId?: string } | null {
  const words = [...new Set((text.match(/\b[A-Z][a-z'’-]{2,}\b/g) ?? []).map((w) => w.toLowerCase()))];
  const staffFirst = new Set(dir.staff.map((s) => s.firstName));
  let best: { id: string; fullName: string; exact: boolean; unitId?: string; score: number } | null = null;
  for (const w of words) {
    if (staffFirst.has(w)) continue;
    for (const r of dir.residents) {
      const dist = levenshtein(w, r.surname);
      const fuzzyOk = r.surname.length >= 6 && dist === 1;
      if (dist !== 0 && !fuzzyOk) continue;
      const stay = r.stays.find((s) => s.start <= isoDate && (!s.end || s.end >= isoDate));
      if (!stay) continue;
      const unitMatch = preferUnitIds.includes(stay.unitId);
      const score = (dist === 0 ? 2 : 1) + (unitMatch ? 3 : 0);
      if (!best || score > best.score) best = { id: r.id, fullName: r.fullName, exact: dist === 0 || unitMatch, unitId: stay.unitId, score };
    }
  }
  return best;
}

const staffByName = (dir: Directory, name: string | undefined) => {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return dir.staff.find((s) => s.fullName.toLowerCase() === n) ?? dir.staff.find((s) => s.firstName === n.split(" ")[0]);
};

function classifySentence(s: string, staffStart: RegExp): ClaimDraft {
  const outcome = outcomeOf(s);
  if (CUES.notInvestigated.test(s)) return { classification: "documented_action", outcome: "not_investigated", text: s };
  if (CUES.noContactAttempt.test(s)) return { classification: "documented_action", outcome: "no_contact_attempt", text: s };
  if (CUES.denial.test(s)) return { classification: "statement", outcome: "denial", text: s };
  if (CUES.actionStart.test(s)) return { classification: "documented_action", outcome: outcome === "no_answer" ? outcome : undefined, text: s };
  if (staffStart.test(s) && CUES.observation.test(s)) return { classification: "staff_observation", outcome, text: s };
  if (CUES.allegation.test(s)) return { classification: "allegation", text: s };
  if (CUES.action.test(s)) return { classification: "documented_action", text: s };
  if (CUES.observation.test(s)) return { classification: "staff_observation", outcome, text: s };
  return { classification: "note", text: s };
}

const TYPE_MAP: Record<string, string> = { complaint: "complaint_report", inspection: "investigation", request: "request" };

// ---------------------------------------------------------------- shift notes (and in-app / voice entries)

function extractShiftNote(rec: ParsedRecord, dir: Directory): { events: EventDraft[]; reviews: ReviewDraft[] } {
  const j = rec.json as { staff?: string; unit?: string; type?: string; eventLocal?: { date: string; time?: string } | null };
  const reviews: ReviewDraft[] = [];
  const recorder = staffByName(dir, j.staff);
  const occurredAt = rec.occurredAt ?? rec.recordedAt ?? new Date();
  const local = localParts(occurredAt, dir.timezone);
  const text = rec.text;
  const category = categorize(text);
  let columnUnit = findUnits(j.unit ?? "", dir)[0];
  const mentioned = findUnits(text, dir);
  if (!columnUnit && mentioned.length) {
    // No unit was entered. If the note names a resident whose own apartment is mentioned, that is the unit involved.
    const named = matchResident(dir, text, mentioned.map((u) => dir.units.get(u)!.id), local.date);
    const own = named?.exact ? mentioned.find((u) => dir.units.get(u)!.id === named.unitId) : undefined;
    if (own) columnUnit = own;
  }
  const staffStart = CUES.staffSubject(dir.staff.map((s) => s.firstName));
  const sentences = splitSentences(text);
  const claims = sentences.map((s) => classifySentence(s, staffStart));
  const lateEntry = CUES.lateEntry.test(text) || (!!rec.recordedAt && rec.recordedAt.getTime() - occurredAt.getTime() > 60 * 60000);

  // Event type: explicit column when present, otherwise inferred from the sentences.
  const hasAllegation = claims.some((c) => c.classification === "allegation");
  const notInvestigated = claims.some((c) => c.outcome === "not_investigated");
  const firstInvestigative = claims.findIndex((c) => c.classification === "staff_observation" && CUES.investigative.test(c.text));
  let type = TYPE_MAP[(j.type ?? "").toLowerCase()] ?? "";
  if (!type) {
    if (CUES.followUp.test(text) && REQUEST_CATEGORIES.has(category)) type = "follow_up";
    else if (hasAllegation && CUES.request.test(text) && REQUEST_CATEGORIES.has(category)) type = "request";
    else if (hasAllegation && COMPLAINT_CATEGORIES.has(category)) type = "complaint_report";
    else if (!hasAllegation && firstInvestigative >= 0) type = "investigation";
    else type = "note";
  } else if (type === "request" && CUES.followUp.test(text)) type = "follow_up";

  const columnUnitId = columnUnit ? dir.units.get(columnUnit)!.id : undefined;
  const otherUnit = mentioned.find((u) => u !== columnUnit);
  const reporterish = type === "complaint_report" || type === "request" || type === "follow_up";
  let reporterUnitId = reporterish ? columnUnitId : undefined;
  let unitId = reporterish ? (type === "complaint_report" && otherUnit ? dir.units.get(otherUnit)!.id : columnUnitId) : (columnUnitId ?? (mentioned[0] ? dir.units.get(mentioned[0])!.id : undefined));

  // Reporter identity from the name written in the note.
  let reporterResidentId: string | undefined, reporterName: string | undefined;
  let confidence = 1;
  if (reporterish) {
    const match = matchResident(dir, text, reporterUnitId ? [reporterUnitId] : [], local.date);
    if (match) {
      reporterResidentId = match.id;
      reporterName = match.fullName;
      if (!reporterUnitId) {
        // A name with no apartment: plausible but unconfirmed. Hold it for human review.
        confidence = 0.5;
        reviews.push({ type: "ambiguous_identity", title: `Confirm resident: "${rec.text.match(/\b(Mr|Mrs|Ms|Miss)\.? ?([A-Z][a-z]+)/)?.[0] ?? match.fullName}"`, detail: `The entry names a resident but no apartment. Closest directory match is ${match.fullName}. The event is not linked to a unit or case until someone confirms.`, eventKey: "a" });
      } else if (!match.exact) confidence = 0.8;
    } else if (reporterUnitId) {
      const occ = occupantAt(dir, reporterUnitId, local.date);
      if (occ) [reporterResidentId, reporterName] = [occ.id, occ.fullName];
    }
    if (!reporterUnitId && !unitId && isCaseCategory(category)) {
      reporterUnitId = undefined;
      unitId = undefined;
    }
  }

  const investigatorOf = (cs: ClaimDraft[]) => {
    for (const c of cs) {
      if (c.classification !== "staff_observation") continue;
      const first = c.text.match(/^([A-Z][a-z]+)\b/)?.[1]?.toLowerCase();
      const s = first && dir.staff.find((x) => x.firstName === first);
      if (s) return s.id;
    }
    return recorder?.id;
  };

  const base = {
    category, channel: /\b(called|phoned|call)\b/i.test(text) ? "phone" : /\b(came to the desk|at the desk|in person|stopped at)\b/i.test(text) ? "in_person" : /\bradioed\b/i.test(text) ? "radio" : "shift_log",
    direction: "internal" as const, mentionedUnitIds: mentioned.map((u) => dir.units.get(u)!.id), floors: findFloors(text),
    recordedAt: rec.recordedAt, lateEntry, recorderUserId: recorder?.id, confidence, hasAttachment: false,
  };
  const clockOn = (cs: ClaimDraft[], fallback: Date) => {
    for (const c of cs) {
      const t = findClock(c.text);
      if (!t) continue;
      let at = zonedToUtc(local.date, t, dir.timezone);
      // A time just after midnight belongs to the next calendar day of a late-evening entry.
      if (at.getTime() < fallback.getTime() - 6 * 3600_000) at = zonedToUtc(addDays(local.date, 1), t, dir.timezone);
      return at;
    }
    return fallback;
  };

  const events: EventDraft[] = [];
  const shouldSplit = type === "complaint_report" && hasAllegation && firstInvestigative > 0 && !notInvestigated;
  if (shouldSplit) {
    const a = claims.slice(0, firstInvestigative);
    const b = claims.slice(firstInvestigative);
    const inv = investigatorOf(b);
    events.push({ ...base, key: "a", type, summary: truncate(a.map((c) => c.text).join(" "), 220), unitId, reporterUnitId, reporterResidentId, reporterName, occurredAt: clockOn(a, occurredAt), claims: a });
    events.push({ ...base, key: "b", type: "investigation", channel: "in_person", summary: truncate(b.map((c) => c.text).join(" "), 220), unitId, occurredAt: clockOn(b, occurredAt), investigatorUserId: inv, claims: b.map((c) => (c.classification === "staff_observation" ? { ...c, observerUserId: inv } : c)) });
  } else {
    const inv = type === "investigation" ? investigatorOf(claims) : undefined;
    const observer = inv ?? recorder?.id;
    const finalClaims = claims.map((c) => {
      if (c.classification === "staff_observation") return { ...c, observerUserId: observer };
      // In a request, what the resident says is a statement of need, not an allegation.
      if (c.classification === "allegation" && (type === "request" || type === "follow_up")) return { ...c, classification: "statement" as const };
      return c;
    });
    events.push({ ...base, key: "a", type, channel: type === "investigation" ? "in_person" : base.channel, summary: truncate(text, 220), unitId, reporterUnitId, reporterResidentId, reporterName, occurredAt, investigatorUserId: inv, claims: finalClaims });
  }
  return { events, reviews };
}

// ---------------------------------------------------------------- email

const isSignatureOrGreeting = (s: string) => /^(dear|hello|hi|good (morning|afternoon|evening)|thanks?|thank you|regards|sincerely)\b[^.]{0,40}[,.]?$/i.test(s) || (s.split(/\s+/).length <= 5 && !/[.!?]$/.test(s));

function extractEmail(rec: ParsedRecord, dir: Directory): { events: EventDraft[]; reviews: ReviewDraft[] } {
  const j = rec.json as { messageId: string; inReplyTo: string | null; references: string[]; subject: string; from: { name: string; address: string }; to: { name: string; address: string }[]; attachments: { filename: string }[] };
  const reviews: ReviewDraft[] = [];
  const occurredAt = rec.occurredAt ?? new Date();
  const isoDate = localParts(occurredAt, dir.timezone).date;
  const domain = j.from.address.split("@")[1] ?? "";
  const outbound = dir.staffDomains.includes(domain);
  const sender = dir.residents.find((r) => r.email === j.from.address);
  const senderStay = sender?.stays.find((s) => s.start <= isoDate && (!s.end || s.end >= isoDate));
  const staffSender = dir.staff.find((s) => s.email === j.from.address);
  const full = `${j.subject}\n${rec.text}`;
  const category = categorize(full);
  const mentioned = findUnits(full, dir);
  const recipient = dir.residents.find((r) => j.to.some((t) => t.address === r.email));
  const recipientStay = recipient?.stays.find((s) => s.start <= isoDate && (!s.end || s.end >= isoDate));

  const otherUnit = mentioned.find((u) => u !== senderStay?.unitLabel);
  const unitId = otherUnit ? dir.units.get(otherUnit)!.id : outbound ? recipientStay?.unitId : senderStay?.unitId;
  const threadKey = j.references[0] ?? j.inReplyTo ?? j.messageId;
  const isReply = !!j.inReplyTo;
  const toList = j.to.some((t) => /^(residents|all|everyone)/.test(t.address));
  const unknownSender = !outbound && !sender && isCaseCategory(category) && COMPLAINT_CATEGORIES.has(category);

  let type: string;
  if (outbound) type = toList ? "notice" : "response";
  else if (sender && isReply && senderStay && unitId === senderStay.unitId && CUES.denial.test(rec.text)) type = "resident_statement";
  else if (COMPLAINT_CATEGORIES.has(category)) type = /\b(repaired|looks good|resolved|thank you\.?$)/i.test(rec.text) && isReply && !/\b(again|still|continues)\b/i.test(rec.text) ? "resident_statement" : "complaint_report";
  else if (REQUEST_CATEGORIES.has(category)) type = CUES.followUp.test(full) ? "follow_up" : "request";
  else type = "correspondence";

  const sentences = rec.text.split(/\n{2,}/).flatMap((p) => splitSentences(p.replace(/\n/g, " "))).filter((s) => !isSignatureOrGreeting(s));
  const claims: ClaimDraft[] = sentences.map((s) => {
    if (outbound) return { classification: /\b(we|i) (will|have|would|need)\b|\b(has|have) been\b|\bwas sent\b|\bwent out\b|\breplaced\b|\bchecked\b|\bapproved\b|\bscheduled\b/i.test(s) ? "documented_action" : "statement", text: s };
    if (CUES.denial.test(s)) return { classification: "statement", outcome: "denial", text: s };
    if (type === "complaint_report") return { classification: "allegation", text: s };
    return { classification: "statement", text: s };
  });

  if (unknownSender) reviews.push({ type: "ambiguous_identity", title: "Complaint from an unidentified sender", detail: `Sender ${j.from.address} is not in the resident directory. Its content is kept as an unverified report and is not counted toward any case until reviewed.`, eventKey: "a" });

  const event: EventDraft = {
    key: "a", type, category, channel: "email", direction: outbound ? "outbound" : "inbound", summary: j.subject || truncate(rec.text, 120),
    unitId, reporterUnitId: outbound ? undefined : senderStay?.unitId, reporterResidentId: outbound ? undefined : sender?.id, reporterName: outbound ? undefined : (sender?.fullName ?? (j.from.name || j.from.address)),
    mentionedUnitIds: mentioned.map((u) => dir.units.get(u)!.id), floors: findFloors(full), occurredAt, recordedAt: occurredAt, receivedAt: occurredAt, lateEntry: false,
    recorderUserId: staffSender?.id, threadKey, externalRef: j.messageId, inReplyToRef: j.inReplyTo ?? undefined, claims, confidence: unknownSender ? 0.3 : 1, hasAttachment: j.attachments.length > 0, unknownSender,
  };
  return { events: [event], reviews };
}

// ---------------------------------------------------------------- work orders

function extractWorkOrder(rec: ParsedRecord, dir: Directory): { events: EventDraft[]; reviews: ReviewDraft[] } {
  const j = rec.json as { number: string; unit: string; title: string; description: string; status: string; assignee: string; createdBy: string; resolution: string };
  const assignee = staffByName(dir, j.assignee);
  const creator = staffByName(dir, j.createdBy);
  const full = `${j.title}. ${j.description} ${j.resolution}`;
  const columnUnit = findUnits(j.unit, dir)[0];
  const mentioned = findUnits(full, dir);
  const claims: ClaimDraft[] = [
    ...splitSentences(`${j.title}. ${j.description}`).map<ClaimDraft>((s) => ({ classification: "documented_action", text: s })),
    ...splitSentences(j.resolution).map<ClaimDraft>((s) => ({ classification: "staff_observation", outcome: outcomeOf(s), text: s, observerUserId: assignee?.id })),
  ];
  return {
    events: [{
      key: "a", type: "work_order", category: categorize(full), channel: "work_order", direction: "internal", summary: `${j.number} ${j.title} — ${j.status}`,
      unitId: columnUnit ? dir.units.get(columnUnit)!.id : undefined, mentionedUnitIds: [...new Set([columnUnit, ...mentioned].filter(Boolean) as string[])].map((u) => dir.units.get(u)!.id), floors: [],
      occurredAt: rec.occurredAt ?? new Date(), recordedAt: rec.recordedAt, lateEntry: false, recorderUserId: creator?.id, assigneeUserId: assignee?.id,
      investigatorUserId: j.resolution ? assignee?.id : undefined, claims, confidence: 1, hasAttachment: false,
    }],
    reviews: [],
  };
}

// ---------------------------------------------------------------- entry point

export function extractRecord(rec: ParsedRecord, dir: Directory, defaults: { visibility: "staff" | "management" | "restricted" }): Extraction {
  const screen = screenContent(`${rec.title}\n${rec.text}`);
  let events: EventDraft[] = [];
  let reviews: ReviewDraft[] = [];
  if (rec.kind === "shift_note") ({ events, reviews } = extractShiftNote(rec, dir));
  else if (rec.kind === "email") ({ events, reviews } = extractEmail(rec, dir));
  else if (rec.kind === "work_order") ({ events, reviews } = extractWorkOrder(rec, dir));

  const hasPerson = events.some((e) => e.reporterResidentId || e.reporterName) || /\b(Mr|Mrs|Ms)\.? ?[A-Z]/.test(rec.text);
  const caseLike = events.some((e) => COMPLAINT_CATEGORIES.has(e.category) && ["complaint_report", "resident_statement", "response", "investigation"].includes(e.type));
  let sensitivity = rec.kind === "policy_doc" ? "public_policy" : rec.kind === "work_order" || rec.kind === "document" ? "internal_ops" : hasPerson ? "resident_pi" : "internal_ops";
  if (rec.kind === "email" && (caseLike || screen.legal)) sensitivity = "confidential_case";
  let visibility = defaults.visibility;
  if (screen.legal && visibility === "staff") visibility = "management";
  if (screen.highlySensitive) {
    sensitivity = "highly_sensitive";
    visibility = "restricted";
    reviews.push({ type: "sensitive_content", title: "Highly sensitive content detected", detail: "This record appears to contain identification, credential, financial or accommodation-related material. Access is restricted until a manager reviews it." });
  } else if (screen.health) {
    reviews.push({ type: "sensitive_content", title: "Possible health information", detail: "The sender mentions a health condition. Confirm this record should remain in case material and be excluded from external model processing if required." });
  }
  if (screen.injection) {
    reviews.push({ type: "suspected_injection", title: "Text addressed to an AI system", detail: "This record contains instruction-like text aimed at an automated assistant. It is stored as evidence only; the assistant treats it as untrusted content and it is withheld from model prompts." });
  }
  return { events, reviews, sensitivity, visibility, injection: screen.injection };
}
