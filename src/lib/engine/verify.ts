/**
 * Independent claim verification. Runs on every answer before display or export, whether
 * the wording came from the deterministic composer or from a model.
 *
 * For each claim it re-reads the cited source records from the database under the caller's
 * permissions and checks:
 *   1. every cited record exists, is visible to this user, and still matches its stored hash
 *   2. every quoted passage appears verbatim in a cited record
 *   3. every calendar date mentioned is a date of a cited record or is written in one
 *   4. every staff member named handled, or is named in, a cited record
 *   5. every count attached to a counted noun equals a structured fact
 *   6. the claim does not assert confirmation that staff observations do not support
 * A claim that fails is withheld from the answer and reported as such.
 */
import { and, inArray } from "drizzle-orm";
import { visibleScope, type AccessContext } from "../access";
import { getDb } from "../db/client";
import { sourceRecords } from "../db/schema";
import { normalizeText, recordHash } from "../util/core";
import { localParts } from "../util/time";
import type { AnswerClaim, Fact, TimelineItem } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`, "gi");
const COUNT_RE = /\b(\d{1,3}) (reports?|complaints?|staff checks?|checks?|inspections?|emails?|replies|messages?|follow-ups?)\b/gi;
const COUNT_KEYS: Record<string, string[]> = {
  report: ["complaints"], complaint: ["complaints"], "staff check": ["investigations", "negative_checks", "common_area_odor", "direct_observation"], check: ["investigations", "negative_checks", "common_area_odor", "direct_observation"],
  inspection: ["investigations"], email: ["unanswered", "complaints_email", "inbound"], reply: ["responses"], replie: ["responses"], message: ["responses"], "follow-up": ["follow_ups"],
};
const OVERCLAIM = /\b(confirmed|verified|proved|proven|established|substantiated)\b[^.]{0,60}\b(smok|noise|violation)|\b(smok\w+|noise|violation)\b[^.]{0,40}\b(was|were|has been|have been) (confirmed|verified|proven|established|substantiated)\b/i;
const NEGATED = /\b(no|not|never|cannot|can't|do not|does not|did not|have not|has not|unable to|without)\b/i;

export type VerifyContext = { facts: Fact[]; timeline: TimelineItem[]; staffNames: string[]; directObservation: boolean; extraCounts?: Record<string, number> };

export async function verifyClaims(ctx: AccessContext, claims: Omit<AnswerClaim, "verification">[], v: VerifyContext): Promise<AnswerClaim[]> {
  const db = await getDb(ctx);
  const ids = [...new Set(claims.flatMap((c) => c.sourceIds))];
  const rows = ids.length ? await db.select().from(sourceRecords).where(and(visibleScope(ctx, sourceRecords), inArray(sourceRecords.id, ids))) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const intact = new Map(rows.map((r) => [r.id, r.lifecycle === "disposed" || recordHash(r.kind, r.rawText, r.rawJson) === r.contentHash]));
  const itemsBySource = new Map<string, TimelineItem[]>();
  for (const i of v.timeline) itemsBySource.set(i.sourceId, [...(itemsBySource.get(i.sourceId) ?? []), i]);
  const factN = new Map<string, number>(v.facts.filter((f) => f.n !== undefined).map((f) => [f.key, f.n!]));
  for (const [k, n] of Object.entries(v.extraCounts ?? {})) factN.set(k, n);

  return claims.map((c) => {
    const fail = (issue: string): AnswerClaim => ({ ...c, verification: "unverified", issue });
    const cited = c.sourceIds.map((id) => byId.get(id));
    if (cited.some((r) => !r)) return fail("Cites a record that does not exist or that you are not permitted to see.");
    if (c.sourceIds.some((id) => intact.get(id) === false)) return fail("A cited record no longer matches its stored hash.");
    const records = cited as (typeof rows)[number][];
    const corpus = normalizeText(records.map((r) => `${r.title} ${r.rawText} ${JSON.stringify(r.rawJson)}`).join(" \n "));
    const items = c.sourceIds.flatMap((id) => itemsBySource.get(id) ?? []);

    // 2. quotes
    for (const m of c.text.matchAll(/"([^"]{12,})"/g)) {
      const quote = normalizeText(m[1].replace(/…$/, ""));
      if (records.length && !corpus.includes(quote.slice(0, 160))) return fail("Contains a quotation that does not appear in the cited record.");
    }
    if (!records.length) {
      // Claims with no source may only restate structured facts (roster, directory, workflow state).
      if (c.classification === "allegation" || c.classification === "staff_observation") return fail("An allegation or observation must cite a source record.");
      if (OVERCLAIM.test(c.text) && !NEGATED.test(c.text)) return fail("Asserts confirmation that the staff observations on record do not support.");
      return { ...c, verification: "verified" };
    }
    // 3. dates
    const tz = ctx.timezone;
    const recordDates = new Set<string>();
    for (const r of records) for (const d of [r.occurredAt, r.recordedAt, r.receivedAt]) if (d) recordDates.add(localParts(d, tz).date.slice(5));
    for (const i of items) for (const d of [i.occurredAt, i.recordedAt]) if (d) recordDates.add(localParts(new Date(d), tz).date.slice(5));
    for (const m of c.text.matchAll(DATE_RE)) {
      const md = `${String(MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      const written = corpus.includes(`${m[1].toLowerCase()}`) && new RegExp(`\\b${m[1].slice(0, 3)}[a-z]*\\.? ${Number(m[2])}\\b`, "i").test(corpus);
      const structured = v.facts.some((f) => new RegExp(`\\b${m[1].slice(0, 3)}[a-z]*\\.? ${Number(m[2])}\\b`, "i").test(f.value));
      if (!recordDates.has(md) && !written && !structured && !corpus.includes(`-${md}`)) return fail(`Mentions ${m[0]}, which is not the date of any cited record.`);
    }
    // 4. staff names
    const actors = normalizeText(items.flatMap((i) => [i.recordedBy?.name, i.onDuty?.name, i.investigatedBy?.name, i.respondedBy?.name, i.assignee?.name, ...i.claims.map((x) => x.observer)]).filter(Boolean).join(" ") + " " + records.map((r) => r.author ?? "").join(" "));
    for (const name of v.staffNames) {
      if (!c.text.includes(name)) continue;
      const first = normalizeText(name.split(" ")[0]);
      if (!actors.includes(normalizeText(name)) && !corpus.includes(first)) return fail(`Names ${name}, who does not appear in the cited records.`);
    }
    // 5. counts
    for (const m of c.text.matchAll(COUNT_RE)) {
      const noun = m[2].toLowerCase().replace(/s$/, "");
      const keys = COUNT_KEYS[noun];
      if (!keys) continue;
      const n = Number(m[1]);
      const allowed = keys.map((k) => factN.get(k)).filter((x): x is number => x !== undefined);
      if (allowed.length && !allowed.includes(n) && n !== c.sourceIds.length) return fail(`States ${m[0]}, which does not match the structured count.`);
    }
    // 6. confirmation without observation
    if (!v.directObservation && OVERCLAIM.test(c.text) && !NEGATED.test(c.text)) return fail("Asserts confirmation that the staff observations on record do not support.");
    return { ...c, verification: "verified" };
  });
}
