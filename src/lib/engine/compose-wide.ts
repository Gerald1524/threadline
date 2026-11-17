/** Composers that range beyond one case: policy lookup, property briefing, unit history, search. */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { can, scopeOf, visibleScope, type AccessContext } from "../access";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { CATEGORY_LABEL } from "../ingest/lexicon";
import { currentPolicyFor, listPolicies } from "../services/policies";
import { fmtDate, fmtDateTime } from "../util/time";
import { buildCaseEvidence, buildItems, loadLookups, type CaseEvidence } from "./evidence";
import type { Draft } from "./compose";
import type { ParsedQuestion } from "./query";
import { searchRecords } from "./search";
import type { AnswerClaim, Classification, CoverageNote, SourceRef, SuggestedAction } from "./types";

type C = Omit<AnswerClaim, "verification">;
const mk = (out: C[]) => (classification: Classification, text: string, sourceIds: string[] = []) => out.push({ id: `c${out.length + 1}`, classification, text, sourceIds: [...new Set(sourceIds)] });
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const empty = (intent: string): Draft => ({ intent, headline: "", claims: [], facts: [], timeline: [], gaps: [], conflicts: [], openItems: [], actions: [], sources: [], coverage: [], restrictedNote: null, focus: {}, caseRef: null, openSourceId: null });

/** Source refs for arbitrary visible source records, labelled S1.. in the order given. */
export async function sourceRefs(ctx: AccessContext, ids: string[]): Promise<SourceRef[]> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const db = await getDb(ctx);
  const rows = await db.select().from(t.sourceRecords).where(and(visibleScope(ctx, t.sourceRecords), inArray(t.sourceRecords.id, uniq)));
  const srcs = new Map((await db.select().from(t.dataSources).where(scopeOf(ctx, t.dataSources))).map((s) => [s.id, s.name]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return uniq.filter((id) => byId.has(id)).map((id, i) => {
    const s = byId.get(id)!;
    return { id: s.id, label: `S${i + 1}`, kind: s.kind, title: s.title, externalId: s.externalId, locator: s.locator, sourceName: srcs.get(s.sourceId) ?? "Unknown source", author: s.author, occurredAt: s.occurredAt?.toISOString() ?? null, recordedAt: s.recordedAt?.toISOString() ?? null, contentHash: s.contentHash, version: s.version, flagged: s.injectionFlag, sensitivity: s.sensitivity };
  });
}

export async function coverageNotes(ctx: AccessContext): Promise<CoverageNote[]> {
  const db = await getDb(ctx);
  const [c] = await db.select().from(t.cases).where(visibleScope(ctx, t.cases)).limit(1);
  if (!c) return [];
  return (await buildCaseEvidence(ctx, c.id))?.coverage ?? [];
}

// ---------------------------------------------------------------- policy

const clauseKeywords = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["that", "this", "with", "from", "have", "will", "when", "must", "they", "their", "before", "after", "about", "what", "does", "maintenance", "resident", "residents", "staff", "policy"].includes(w)));

export async function composePolicy(ctx: AccessContext, q: ParsedQuestion, focus: CaseEvidence | null): Promise<Draft> {
  const draft = empty("policy_lookup");
  const out: C[] = [];
  const add = mk(out);
  const category = q.category !== "general" && q.category !== "maintenance" ? q.category : (focus?.case.category ?? q.category);
  const all = await listPolicies(ctx);
  const policy = (await currentPolicyFor(ctx, { category })) ?? all.find((p) => p.current && [...clauseKeywords(q.text)].some((w) => p.title.toLowerCase().includes(w))) ?? null;
  if (!policy?.current) {
    add("missing_evidence", `No approved policy on ${CATEGORY_LABEL[category]?.toLowerCase() ?? "this topic"} is on file for ${ctx.propertyName}. A manager's decision is needed; staff should not improvise one.`);
    draft.claims = out;
    draft.headline = "No approved policy found for this question.";
    return draft;
  }
  const v = policy.current;
  const sr = v.sourceRecordId ? [v.sourceRecordId] : [];
  add("documented_action", `The current approved policy is "${policy.title}", version ${v.version}${v.effectiveFrom ? `, effective ${fmtDate(`${v.effectiveFrom}T12:00:00Z`, "UTC")}` : ""}${v.approvedByName ? `, approved by ${v.approvedByName}` : ""}.`, sr);

  const request = focus?.requests[0] ?? null;
  const requestText = request?.claims.map((c) => c.text).join(" ") ?? "";
  const want = clauseKeywords(`${q.text} ${requestText}`);
  // Residents and staff rarely use the policy's own vocabulary; widen the match with topic synonyms.
  const TOPIC: [RegExp, string[]][] = [
    [/mirror|hang|mount|picture|shelf|shelves|install/i, ["install", "installation", "mounted", "items", "anchored", "wall"]],
    [/drill|power tool/i, ["power", "tools", "drills", "loaned"]],
    [/borrow|lend|loan/i, ["loan", "loaned", "lend", "tools", "hand"]],
    [/\bkeys?\b|fob|locked out|lockout/i, ["keys", "replacement", "lockouts", "released", "approval"]],
    [/noise|loud|music/i, ["quiet", "hours", "noise", "complaint"]],
    [/smok/i, ["smoking", "complaint", "violation", "notice"]],
    [/move|elevator/i, ["moves", "elevator", "exception", "movers"]],
  ];
  for (const [re, words] of TOPIC) if (re.test(`${q.text} ${requestText}`)) for (const w of words) want.add(w);
  const hasWeight = /\d\s?(lbs?|pounds)\b/i.test(`${q.text} ${requestText}`);
  const clauses = v.body.split("\n").map((l) => l.trim()).filter((l) => /^\d+\./.test(l));
  const scored = clauses.map((cl) => ({ cl, score: [...clauseKeywords(cl)].filter((w) => want.has(w) || [...want].some((x) => x.startsWith(w.slice(0, 5)))).length + (hasWeight && /\blbs\b/i.test(cl) ? 3 : 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const chosen = (scored.length ? scored.slice(0, 4).map((x) => x.cl) : clauses).sort((a, b) => parseInt(a) - parseInt(b));
  for (const cl of chosen) add("documented_action", `Clause ${cl.replace(/^(\d+)\.\s*/, '$1: "')}"`, sr);

  // Deterministic threshold check: compare a stated weight with the limits written in the policy.
  const weight = Number(`${q.text} ${requestText}`.match(/(\d{1,4})\s?(?:lbs?|pounds)\b/i)?.[1]);
  const limit = Number(v.body.match(/over (\d{1,4}) lbs/i)?.[1]);
  let verdict = "";
  if (weight && limit) {
    const over = weight > limit;
    verdict = over ? `At about ${weight} lbs the item is over the ${limit} lb limit, so Community Manager review is required before any work is scheduled.` : `At about ${weight} lbs the item is within the ${limit} lb limit for installation by maintenance under a work order.`;
    add("note", `${request ? "The request on record mentions" : "You mentioned"} about ${weight} lbs. ${verdict}`, [...sr, ...(request ? [request.sourceId] : [])]);
  }
  const older = policy.versions.filter((x) => x.status === "superseded");
  if (older.length) add("note", `Version${older.length > 1 ? "s" : ""} ${older.map((x) => x.version).join(", ")} of this policy ${older.length > 1 ? "are" : "is"} superseded and no longer applies.`, older.flatMap((x) => (x.sourceRecordId ? [x.sourceRecordId] : [])));
  if (can(ctx, "management.read")) {
    const db = await getDb(ctx);
    const docs = await db.select().from(t.sourceRecords).where(and(visibleScope(ctx, t.sourceRecords), eq(t.sourceRecords.kind, "document"), sql`${t.sourceRecords.rawJson}->>'draft' = 'true'`));
    const related = docs.filter((d) => [...clauseKeywords(policy.title)].some((w) => d.rawText.toLowerCase().includes(w)));
    for (const d of related) add("note", `A draft working document ("${d.title}") also discusses this topic. It is not approved policy and was not used for this answer.`, [d.id]);
  }
  const needsReview = /community manager|manager review|approval/i.test(chosen.join(" "));
  const actions: SuggestedAction[] = [];
  if (needsReview && can(ctx, "approvals.request")) {
    const unit = focus?.subjectLabel ?? q.units[0];
    actions.push({ kind: "request_approval", label: "Create review request for the manager", approvalType: category === "installation_tools" ? "installation_review" : category === "key_access" ? "key_replacement" : "policy_exception", title: `${CATEGORY_LABEL[category] ?? "Policy"} review${unit ? ` — ${unit}` : ""}`, detail: `${requestText || q.text}\n\nPolicy: ${policy.title} v${v.version}.${verdict ? ` ${verdict}` : ""}`, caseId: focus?.case.id, unitId: focus?.case.unitId ?? undefined, policyVersionId: v.id });
  }
  actions.push({ kind: "link", label: "Open policy", href: `/policies#${policy.key}` });
  draft.claims = out;
  draft.sources = await sourceRefs(ctx, out.flatMap((c) => c.sourceIds));
  draft.actions = actions;
  draft.headline = `${policy.title} (v${v.version}, approved). ${verdict || "The relevant clauses are quoted below."}`;
  draft.focus = { policyKey: policy.key, caseId: focus?.case.id, unitId: focus?.case.unitId ?? undefined };
  draft.caseRef = focus ? { id: focus.case.id, number: focus.case.number, title: focus.case.title, status: focus.case.status } : null;
  return draft;
}

// ---------------------------------------------------------------- property briefing

export async function composeBriefing(ctx: AccessContext, now: Date): Promise<Draft> {
  const draft = empty("property_briefing");
  const out: C[] = [];
  const add = mk(out);
  const tz = ctx.timezone;
  const db = await getDb(ctx);
  const open = await db.select().from(t.cases).where(and(visibleScope(ctx, t.cases), inArray(t.cases.status, ["open", "investigating", "awaiting_response"]))).orderBy(desc(t.cases.openedAt));
  const evidences = (await Promise.all(open.map((c) => buildCaseEvidence(ctx, c.id, now)))).filter((e): e is CaseEvidence => !!e);
  evidences.sort((a, b) => (b.confirmed.at(-1)?.occurredAt ?? "").localeCompare(a.confirmed.at(-1)?.occurredAt ?? ""));
  const recurring = evidences.filter((e) => e.complaints.length >= 3);
  for (const e of evidences) {
    const last = e.confirmed.at(-1);
    const n = e.complaints.length ? `${plural(e.complaints.length, "report")}, ${plural(e.investigations.length, "staff check")}` : `${plural(e.requests.length + e.followUps.length, "request/follow-up")}`;
    const openList = e.openItems.filter((o) => o.kind !== "tentative_link" && o.kind !== "review").slice(0, 2);
    const openBits = openList.map((o) => o.text).join(" ");
    add(e.complaints.length ? "allegation" : "documented_action", `${e.case.number} ${e.case.title} — ${e.case.status.replace("_", " ")}; ${n}; last activity ${last ? fmtDate(last.occurredAt, tz) : "unknown"}.${openBits ? ` Open: ${openBits}` : ""}`, [...(last ? [last.sourceId] : []), ...openList.flatMap((o) => o.sourceIds)]);
  }
  if (recurring.length) add("note", `Recurring issues (three or more reports): ${recurring.map((e) => `${e.case.number} ${e.categoryLabel.toLowerCase()} at ${e.subjectLabel}`).join("; ")}.`);
  const pending = await db.select().from(t.approvals).where(and(scopeOf(ctx, t.approvals), eq(t.approvals.status, "pending")));
  if (pending.length) add("note", `${plural(pending.length, "approval")} waiting for a decision: ${pending.map((a) => `"${a.title}"`).join(", ")}.`);
  const decided = await db.select({ a: t.approvals, u: t.users.fullName }).from(t.approvals).leftJoin(t.users, eq(t.users.id, t.approvals.decidedBy)).where(and(scopeOf(ctx, t.approvals), inArray(t.approvals.status, ["approved", "denied"]), sql`${t.approvals.decidedAt} > ${new Date(now.getTime() - 21 * 86400_000).toISOString()}::timestamptz`)).orderBy(desc(t.approvals.decidedAt));
  if (decided.length) add("note", `Manager decisions in the last three weeks: ${decided.slice(0, 6).map(({ a, u }) => `"${a.title}" ${a.status} by ${u ?? "a manager"} (${fmtDate(a.decidedAt, tz).replace(/, \d{4}$/, "")})`).join("; ")}.`);
  const wos = await db.select().from(t.workOrders).where(and(scopeOf(ctx, t.workOrders), inArray(t.workOrders.status, ["open", "assigned", "in_progress", "on_hold"])));
  const noEta = wos.filter((w) => !w.eta);
  if (wos.length) add("note", `${plural(wos.length, "work order")} open, ${noEta.length} with no ETA${noEta.length ? ` (${noEta.slice(0, 6).map((w) => w.number).join(", ")})` : ""}.`);
  const unanswered = evidences.flatMap((e) => e.unanswered.map((u) => ({ e, u })));
  if (unanswered.length) add("missing_evidence", `Resident emails with no recorded reply: ${unanswered.map(({ e, u }) => `${u.reporter ?? "resident"}, ${fmtDate(u.occurredAt, tz).replace(/, \d{4}$/, "")} (${e.case.number})`).join("; ")}.`, unanswered.map(({ u }) => u.sourceId));
  if (can(ctx, "review.read")) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.reviewItems).where(and(scopeOf(ctx, t.reviewItems), eq(t.reviewItems.status, "open")));
    if (n) add("note", `${plural(n, "item")} in the review inbox (uncertain links, possible duplicates, sensitive content) need a human decision.`);
  }
  const holds = await db.select({ h: t.legalHolds, c: t.cases.number }).from(t.legalHolds).innerJoin(t.cases, eq(t.cases.id, t.legalHolds.caseId)).where(and(scopeOf(ctx, t.legalHolds), isNull(t.legalHolds.releasedAt)));
  if (holds.length && can(ctx, "management.read")) add("note", `Legal hold in place on ${holds.map((h) => h.c).join(", ")}.`);
  const [handoff] = await db.select({ h: t.handoffs, u: t.users.fullName }).from(t.handoffs).leftJoin(t.users, eq(t.users.id, t.handoffs.fromUserId)).where(scopeOf(ctx, t.handoffs)).orderBy(desc(t.handoffs.createdAt)).limit(1);
  if (handoff) add("note", `Latest shift handoff: ${handoff.u ?? "staff"}, ${fmtDateTime(handoff.h.createdAt, tz)} (${handoff.h.shiftLabel}) with ${plural(handoff.h.items.length, "item")}.`);
  draft.coverage = evidences[0]?.coverage ?? (await coverageNotes(ctx));
  for (const cv of draft.coverage) draft.gaps.push({ kind: "coverage", text: `${cv.sourceName}: ${cv.issue}`, sourceIds: [] });
  if (!evidences.length) add("note", "No open cases are visible to your role at this property.");
  draft.claims = out;
  draft.sources = await sourceRefs(ctx, out.flatMap((c) => c.sourceIds));
  draft.headline = `${ctx.propertyName}: ${plural(evidences.length, "open case")}, ${plural(pending.length, "pending approval")}, ${plural(wos.length, "open work order")}${unanswered.length ? `, ${plural(unanswered.length, "resident email")} awaiting a reply` : ""}.`;
  draft.actions = [{ kind: "link", label: "Open cases", href: "/cases" }, { kind: "link", label: "Approvals", href: "/approvals" }, { kind: "link", label: "Work orders", href: "/work-orders" }];
  return draft;
}

// ---------------------------------------------------------------- unit history

export async function composeUnitHistory(ctx: AccessContext, unitLabel: string, now: Date): Promise<Draft> {
  const draft = empty("unit_history");
  const out: C[] = [];
  const add = mk(out);
  const tz = ctx.timezone;
  const db = await getDb(ctx);
  const [unit] = await db.select().from(t.units).where(and(scopeOf(ctx, t.units), eq(t.units.label, unitLabel)));
  if (!unit) {
    draft.headline = `There is no unit ${unitLabel} at ${ctx.propertyName}.`;
    return draft;
  }
  const stays = await db.select({ s: t.residencies, r: t.residents }).from(t.residencies).innerJoin(t.residents, eq(t.residents.id, t.residencies.residentId)).where(and(scopeOf(ctx, t.residencies), eq(t.residencies.unitId, unit.id))).orderBy(desc(t.residencies.startDate));
  const day = (iso: string) => fmtDate(`${iso}T12:00:00Z`, "UTC");
  const current = stays.find(({ s }) => !s.endDate);
  add("note", `Occupancy from the resident directory: ${current ? `${current.r.fullName} since ${day(current.s.startDate)}` : "no current occupant on file"}${stays.filter(({ s }) => s.endDate).map(({ s, r }) => `; previously ${r.fullName} (${day(s.startDate)} – ${day(s.endDate!)})`).join("")}.`);
  const cs = await db.select().from(t.cases).where(and(visibleScope(ctx, t.cases), or(eq(t.cases.unitId, unit.id), eq(t.cases.complainantUnitId, unit.id)))).orderBy(desc(t.cases.openedAt));
  for (const c of cs) {
    const e = await buildCaseEvidence(ctx, c.id, now);
    if (!e) continue;
    const role = c.unitId === unit.id ? "about this unit" : "raised by this unit's resident";
    const occ = stays.find(({ s }) => s.startDate <= c.openedAt.toISOString().slice(0, 10) && (!s.endDate || s.endDate >= c.openedAt.toISOString().slice(0, 10)));
    add(e.complaints.length ? "allegation" : "documented_action", `${c.number} ${c.title} (${role}) — ${c.status.replace("_", " ")}, opened ${fmtDate(c.openedAt, tz)}${occ && c.unitId === unit.id ? `, when ${occ.r.fullName} was the occupant` : ""}: ${e.complaints.length ? `${plural(e.complaints.length, "report")}, ${plural(e.investigations.length, "staff check")}, ${e.direct.length ? "direct staff observation recorded" : "no direct staff observation"}` : `${plural(e.requests.length + e.followUps.length, "request/follow-up")}`}.`, [e.confirmed[0]?.sourceId, e.confirmed.at(-1)?.sourceId].filter(Boolean) as string[]);
  }
  const evs = await db.select().from(t.events).where(and(visibleScope(ctx, t.events), eq(t.events.status, "active"), or(eq(t.events.unitId, unit.id), eq(t.events.reporterUnitId, unit.id)))).orderBy(t.events.occurredAt);
  const { items, sources } = await buildItems(ctx, await loadLookups(ctx), evs);
  const wos = await db.select().from(t.workOrders).where(and(scopeOf(ctx, t.workOrders), eq(t.workOrders.unitId, unit.id)));
  if (wos.length) add("documented_action", `Work orders for ${unitLabel}: ${wos.map((w) => `${w.number} ${w.title} (${w.status.replace("_", " ")})`).join("; ")}.`, wos.flatMap((w) => (w.sourceRecordId ? [w.sourceRecordId] : [])));
  const routine = items.filter((i) => i.type === "note");
  if (routine.length) add("note", `${plural(routine.length, "routine log entry", "routine log entries")} also mention ${unitLabel} (packages, visitors, deliveries).`, routine.slice(0, 3).map((i) => i.sourceId));
  draft.claims = out;
  draft.timeline = items;
  draft.sources = sources;
  draft.coverage = await coverageNotes(ctx);
  draft.headline = `Unit ${unitLabel}: ${plural(cs.length, "case")}, ${plural(items.length, "record")} on file${current ? `; current occupant ${current.r.fullName}` : ""}.`;
  draft.focus = { unitId: unit.id, caseId: cs.find((c) => c.unitId === unit.id && c.status !== "closed")?.id };
  return draft;
}

// ---------------------------------------------------------------- search fallback

export async function composeSearch(ctx: AccessContext, q: ParsedQuestion): Promise<Draft> {
  const draft = empty("search");
  const out: C[] = [];
  const add = mk(out);
  const hits = await searchRecords(ctx, q.text, 8);
  for (const h of hits) add("note", `${h.title}${h.occurredAt ? ` (${fmtDate(h.occurredAt, ctx.timezone)})` : ""}: "${h.snippet.replace(/[«»]/g, "").replace(/\s+/g, " ").trim()}"`, [h.id]);
  draft.coverage = await coverageNotes(ctx);
  if (!hits.length) {
    add("missing_evidence", "No matching record was found in the sources you can access. That is not the same as nothing having happened: a record may exist in a source that is not connected, has not finished importing, or is outside your role's access.");
    for (const cv of draft.coverage) draft.gaps.push({ kind: "coverage", text: `${cv.sourceName}: ${cv.issue}`, sourceIds: [] });
  }
  draft.claims = out;
  draft.sources = await sourceRefs(ctx, hits.map((h) => h.id));
  draft.headline = hits.length ? `${plural(hits.length, "record")} match. These are search results quoted from the originals, not an interpreted answer — name a unit, resident or case for a full reconstruction.` : "No matching record found.";
  return draft;
}
