/**
 * Question understanding without a model: entity resolution (units, residents, case and
 * work-order numbers, dates) and intent routing. Spoken input passes through the same
 * normalizer so "twelve B" and "12B" resolve identically.
 */
import { levenshtein } from "../util/core";
import { addDays, localParts } from "../util/time";
import { categorize } from "../ingest/lexicon";
import type { Directory } from "../ingest/extract";

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
const LETTER_WORDS: Record<string, string> = { a: "A", ay: "A", b: "B", bee: "B", be: "B", c: "C", see: "C", sea: "C", d: "D", dee: "D", e: "E", ee: "E", f: "F", eff: "F" };

/** Turn spoken unit references into written ones: "twelve bee" -> "12B", "12 B" -> "12B". */
export function normalizeSpoken(text: string): string {
  let out = text.replace(new RegExp(`\\b(${Object.keys(NUM_WORDS).join("|")})[ -]+(${Object.keys(LETTER_WORDS).join("|")})\\b`, "gi"), (_, n: string, l: string) => `${NUM_WORDS[n.toLowerCase()]}${LETTER_WORDS[l.toLowerCase()]}`);
  out = out.replace(/\b(\d{1,2})[ -]([A-F])\b(?!\.?m\b)/g, "$1$2");
  out = out.replace(/\b(\d{1,2}) (bee|dee|see|ee|eff)\b/gi, (_, n: string, l: string) => `${n}${LETTER_WORDS[l.toLowerCase()]}`);
  return out;
}

export type Intent = "case_overview" | "status" | "who_on_shift" | "observation_check" | "correspondence" | "show_source" | "case_summary" | "policy_lookup" | "property_briefing" | "unit_history" | "search";

export type ParsedQuestion = {
  text: string;
  intent: Intent;
  units: string[];
  unknownUnits: string[];
  residentIds: string[];
  category: string;
  caseNumber: string | null;
  workOrderNumber: string | null;
  dateIso: string | null;
  daypart: "morning" | "afternoon" | "evening" | "night" | null;
  refersToFocus: boolean;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function findDate(q: string, now: Date, tz: string): string | null {
  const today = localParts(now, tz).date;
  const year = Number(today.slice(0, 4));
  let m = q.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (m) return `${year}-${String(MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (m) return `${m[3] ?? year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/\byesterday\b|\blast night\b/i.test(q)) return addDays(today, -1);
  if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/i.test(q)) return today;
  return null;
}

export function parseQuestion(raw: string, dir: Directory, now: Date): ParsedQuestion {
  const text = normalizeSpoken(raw.trim());
  const lower = text.toLowerCase();
  const units: string[] = [];
  const unknownUnits: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})-?([A-Za-z])\b(?!\.?m\b)/g)) {
    if (/^[ap]$/i.test(m[2]) && /\d\s?[ap]\b/i.test(m[0]) && /\b(at|by|before|after|around)\s+\d{1,2}\s?[ap]\b/i.test(text)) continue;
    const label = `${Number(m[1])}${m[2].toUpperCase()}`;
    if (dir.units.has(label)) { if (!units.includes(label)) units.push(label); }
    else if (/^[A-Z]$/.test(m[2].toUpperCase()) && Number(m[1]) <= 60) unknownUnits.push(label);
  }
  const words = [...new Set((text.match(/\b[A-Z][a-z'’]{2,}\b/g) ?? []).map((w) => w.replace(/['’]s$/, "").toLowerCase()))];
  const residentIds = dir.residents.filter((r) => words.some((w) => w === r.surname || (r.surname.length >= 6 && levenshtein(w, r.surname) === 1))).map((r) => r.id);

  const has = (re: RegExp) => re.test(lower);
  const cue = {
    briefing: has(/what should i know|brief me|\bbriefing\b|catch me up|bring me up to speed|overview of (this|the) (property|building)/),
    history: has(/\b(full |complete |whole )?history (of|for)\b|everything (about|on) (unit )?\d/),
    policy: has(/\bpolic(y|ies)\b|\b(can|may|are|is) (maintenance|staff|we|i|the front desk|a resident|she|he|they)\b.*\b(hang|mount|install|lend|loan|borrow|allow|release|approve|book)\b|\ballowed\b|\bpermitted\b/),
    shift: has(/who (was|is) (working|on duty|on shift|on the desk|at the desk|covering)|who worked\b/),
    observation: has(/did (anyone|anybody|staff|someone|we|a porter|the porter) (actually |ever |personally )?(smell|hear|see|observe|witness|detect)|\b(ever|actually) (confirmed|observed|verified)\b/),
    correspondence: has(/which emails?|what emails?|what did (management|we|priya|the manager) (send|say|write|reply)|did (we|management|anyone|someone) (ever )?(reply|respond|answer|write back)|unanswered|emails? (did|has) management/),
    show: has(/^(show|open|pull up|let me see|display)\b/),
    summary: has(/\bsummar(y|ize|ise)\b|\bfor the new manager\b|\brecap\b/),
    status: has(/what'?s happening with|what is happening with|status of|update on|where (are we|is)|any update|what'?s going on with/),
    overview: has(/when did (this|it|that) start|who investigated|substantiate|what happened|\btimeline\b|chronology|how many (complaints|reports)|what do we know/),
  };
  const narrow = [cue.shift, cue.observation, cue.correspondence].filter(Boolean).length;
  let intent: Intent = "search";
  if (cue.briefing) intent = "property_briefing";
  else if (cue.history) intent = "unit_history";
  else if (cue.policy) intent = "policy_lookup";
  else if (cue.overview || narrow >= 2) intent = "case_overview";
  else if (cue.shift) intent = "who_on_shift";
  else if (cue.observation) intent = "observation_check";
  else if (cue.correspondence) intent = "correspondence";
  else if (cue.show) intent = "show_source";
  else if (cue.summary) intent = "case_summary";
  else if (cue.status) intent = "status";
  else if (units.length || residentIds.length || /\bC-\d{4}\b/i.test(text) || has(/\b(complaint|case|incident|issue|problem|smoke|noise)\b/)) intent = "case_overview";

  const daypart = has(/\bmorning\b/) ? "morning" : has(/\bafternoon\b/) ? "afternoon" : has(/\bevening\b/) ? "evening" : has(/\b(night|overnight)\b/) ? "night" : null;
  return {
    text, intent, units, unknownUnits, residentIds, category: categorize(text), caseNumber: text.match(/\bC-\d{4}\b/i)?.[0].toUpperCase() ?? null, workOrderNumber: text.match(/\bWO-\d{3,5}\b/i)?.[0].toUpperCase() ?? null,
    dateIso: findDate(lower, now, dir.timezone), daypart, refersToFocus: has(/\b(this|that|it|they|the case|the complaint|same)\b/) || (!units.length && !residentIds.length),
  };
}

/** Units that sound alike when spoken, used to offer a correction rather than a wrong answer. */
export const SOUND_ALIKE: Record<string, string[]> = { B: ["D", "E", "C"], D: ["B", "E", "C"], E: ["B", "D", "C"], C: ["B", "D", "E"], A: [], F: [] };
