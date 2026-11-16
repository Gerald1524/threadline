/**
 * Deterministic answer composition. Each composer turns assembled evidence into typed
 * claims that cite source record ids. This is what runs when no model is configured, and it
 * is also the factual skeleton a model's narrative is verified against.
 */
import { can, type AccessContext } from "../access";
import { fmtDate, fmtDateTime, fmtTime, localParts } from "../util/time";
import type { CaseEvidence } from "./evidence";
import type { ParsedQuestion } from "./query";
import type { Answer, AnswerClaim, Classification, Person, SuggestedAction, TimelineItem } from "./types";

export type Draft = Pick<Answer, "intent" | "headline" | "facts" | "timeline" | "gaps" | "conflicts" | "openItems" | "actions" | "sources" | "coverage" | "restrictedNote" | "focus" | "caseRef" | "openSourceId"> & { claims: Omit<AnswerClaim, "verification">[] };

export const role = (p: Person) => p.title.replace(/\s*\(.*$/, "").replace(/ \/ .*$/, "").toLowerCase();
export const who = (p: Person | null | undefined) => (p ? `${p.name} (${role(p)})` : "an unidentified staff member");
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const CHANNEL: Record<string, string> = { phone: "phone call", in_person: "visit to the desk", email: "email", shift_log: "front-desk report", radio: "radio call", app: "Threadline entry" };

class Claims {
  out: Omit<AnswerClaim, "verification">[] = [];
  add(classification: Classification, text: string, sourceIds: string[] = []) {
    this.out.push({ id: `c${this.out.length + 1}`, classification, text, sourceIds: uniq(sourceIds) });
  }
}

const base = (ev: CaseEvidence, intent: string): Draft => ({
  intent, headline: "", claims: [], facts: ev.facts, timeline: ev.items, gaps: ev.gaps, conflicts: ev.conflicts, openItems: ev.openItems, actions: [], sources: ev.sources, coverage: ev.coverage,
  restrictedNote: ev.hiddenCount ? `${plural(ev.hiddenCount, "record")} in this case ${ev.hiddenCount === 1 ? "is" : "are"} restricted to management and ${ev.hiddenCount === 1 ? "is" : "are"} not included in this answer.` : null,
  focus: { caseId: ev.case.id, unitId: ev.case.unitId ?? undefined }, caseRef: { id: ev.case.id, number: ev.case.number, title: ev.case.title, status: ev.case.status }, openSourceId: null,
});

function caseActions(ctx: AccessContext, ev: CaseEvidence): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const openWo = ev.workOrders.find((w) => !["completed", "cancelled"].includes(w.status));
  if (openWo && can(ctx, "messages.draft")) actions.push({ kind: "draft_message", label: "Request maintenance update", messageKind: "maintenance_update_request", caseId: ev.case.id, workOrderId: openWo.id });
  if ((ev.unanswered.length || ev.followUps.length) && can(ctx, "messages.send.resident")) actions.push({ kind: "draft_message", label: "Draft update to resident", messageKind: "resident_update", caseId: ev.case.id });
  if (can(ctx, "reports.generate")) actions.push({ kind: "generate_packet", label: "Generate Case Packet", caseId: ev.case.id });
  actions.push({ kind: "link", label: "Open case", href: `/cases/${ev.case.id}` });
  return actions;
}

const srcOf = (xs: TimelineItem[]) => uniq(xs.map((x) => x.sourceId));

function topicPhrase(ev: CaseEvidence) {
  if (ev.case.category === "smoke_odor") return { reported: `cigarette smoke or odor reaching ${ev.complainantUnit ?? "the reporting apartment"}`, thing: "smoking", sense: "odor", negative: "no odor was detected" };
  if (ev.case.category === "noise") return { reported: "excessive noise", thing: "the noise", sense: "noise", negative: "no noise was heard" };
  return { reported: `a ${ev.categoryLabel.toLowerCase()} problem`, thing: "the reported condition", sense: "the condition", negative: "nothing was found" };
}

function checkLine(i: TimelineItem, tz: string) {
  const found = uniq(i.claims.filter((c) => c.classification === "staff_observation" && c.outcomeLabel).map((c) => c.outcomeLabel!.toLowerCase()));
  return `${fmtDate(i.occurredAt, tz)}, ${fmtTime(i.occurredAt, tz)} — ${i.investigatedBy ? who(i.investigatedBy) : "staff"}: ${found.length ? found.join("; ") : "check recorded, no finding stated"}`;
}

// ---------------------------------------------------------------- complaint cases

export function composeCaseOverview(ctx: AccessContext, ev: CaseEvidence): Draft {
  if (!ev.complaints.length) return composeRequestStatus(ctx, ev, "case_overview");
  const tz = ctx.timezone;
  const draft = base(ev, "case_overview");
  const c = new Claims();
  const t = topicPhrase(ev);
  const first = ev.complaints[0];
  const latest = ev.complaints.at(-1)!;
  const desk = ev.complaints.filter((i) => i.channel !== "email");

  c.add("documented_action", `The first recorded report is a ${CHANNEL[first.channel] ?? first.channel} on ${fmtDateTime(first.occurredAt, tz)} from ${first.reporter ?? "a resident"}${first.reporterUnit ? ` (${first.reporterUnit})` : ""}${first.recordedBy ? `, recorded by ${who(first.recordedBy)}` : ""}${first.onDuty && first.onDuty.id !== first.recordedBy?.id ? `; ${first.onDuty.name} was on the ${first.onDuty.shift.toLowerCase()} desk` : ""}.${latest !== first ? ` The most recent is ${latest.channel === "email" ? "an email" : "a report"} on ${fmtDateTime(latest.occurredAt, tz)}.` : ""}`, [first.sourceId, latest.sourceId]);
  c.add("allegation", `${plural(ev.complaints.length, "report")} — ${desk.length} to the front desk and ${ev.complaints.length - desk.length} by email — describe ${t.reported} and attribute it to ${ev.subjectLabel}. This is the reporting resident's account, not a finding.`, srcOf(ev.complaints));

  if (ev.investigations.length) {
    const byPerson = new Map<string, string[]>();
    for (const i of ev.investigations) {
      const k = i.investigatedBy ? who(i.investigatedBy) : "staff";
      byPerson.set(k, [...(byPerson.get(k) ?? []), fmtDate(i.occurredAt, tz).replace(/, \d{4}$/, "")]);
    }
    c.add("staff_observation", `Staff checked ${plural(ev.investigations.length, "time")}: ${list([...byPerson].map(([p, ds]) => `${p} on ${list(ds)}`))}.`, srcOf(ev.investigations));
    const parts: string[] = [];
    if (ev.negative.length) parts.push(`on ${plural(ev.negative.length, "check")} ${t.negative}`);
    for (const i of ev.commonAreaOdor) {
      const q = i.claims.find((x) => x.outcome === "odor_detected_common_area");
      parts.push(`on ${fmtDate(i.occurredAt, tz).replace(/, \d{4}$/, "")} ${i.investigatedBy?.name ?? "staff"} noted an odor in a common area ("${q?.text}")`);
    }
    for (const i of ev.direct) parts.push(`on ${fmtDate(i.occurredAt, tz)} ${i.investigatedBy?.name ?? "staff"} recorded a direct observation ("${i.claims.find((x) => ["smoking_observed", "odor_detected", "noise_heard"].includes(x.outcome ?? ""))?.text}")`);
    c.add("staff_observation", `What staff found: ${parts.join("; ")}.${ev.direct.length ? "" : ` No check recorded ${t.thing} in, or ${t.sense} coming from, ${ev.subjectLabel}.`}`, srcOf(ev.investigations));
  } else c.add("missing_evidence", "No staff check is recorded for this case.");

  if (ev.responses.length) {
    const by = new Map<string, string[]>();
    for (const r of ev.responses) {
      const k = r.respondedBy?.name ?? "Management";
      by.set(k, [...(by.get(k) ?? []), fmtDate(r.occurredAt, tz).replace(/, \d{4}$/, "")]);
    }
    c.add("documented_action", `Replies on record: ${list([...by].map(([p, ds]) => `${p} wrote on ${list(ds)}`))} (${plural(ev.responses.length, "message")}).`, srcOf(ev.responses));
  } else if (ev.inbound.length) c.add("missing_evidence", "No reply to the resident is on record.");
  for (const u of ev.unanswered) c.add("missing_evidence", `The ${fmtDateTime(u.occurredAt, tz)} email from ${u.reporter ?? "the resident"} ("${u.summary}") has no recorded reply.`, [u.sourceId]);

  if (ev.denials.length) {
    const how = ev.denials.map((x) => (x.channel === "email" ? `in an email on ${fmtDate(x.occurredAt, tz)}` : `to ${x.investigatedBy?.name ?? "staff"} on ${fmtDate(x.occurredAt, tz)}`));
    c.add("statement", `${ev.occupant?.name ?? "The occupant"} of ${ev.subjectLabel} denied it ${list(how)}.`, srcOf(ev.denials));
  }
  for (const k of ev.corroborated.slice(0, 2)) c.add("independently_supported", k.text, k.sourceIds);
  for (const w of ev.workOrders.filter((w) => w.sourceRecordId && ev.sources.some((s) => s.id === w.sourceRecordId))) {
    c.add("documented_action", `Work order ${w.number} (${w.title}) is ${w.status.replace("_", " ")}${w.completedAt ? ` as of ${fmtDate(w.completedAt, tz)}` : ""}${w.assigneeName ? `, assigned to ${w.assigneeName}` : ""}.${w.resolutionNote ? ` Recorded result: "${w.resolutionNote}"` : ""}`, [w.sourceRecordId!]);
  }
  c.add("missing_evidence", `What the records substantiate: that the reports were made, that staff checked ${plural(ev.investigations.length, "time")}, and what staff found. What they do not substantiate: that ${t.thing} occurred in ${ev.subjectLabel}${ev.direct.length ? "" : " — no employee observed it"}.`, srcOf(ev.investigations));
  if (ev.tentative.length) c.add("tentative_link", `${plural(ev.tentative.length, "record")} may be related but ${ev.tentative.length === 1 ? "is" : "are"} unconfirmed and not counted: ${list(ev.tentative.map((x) => `${x.typeLabel.toLowerCase()} of ${fmtDate(x.occurredAt, tz).replace(/, \d{4}$/, "")}`))}.`, srcOf(ev.tentative));
  for (const o of ev.otherCases) {
    const former = ev.formerOccupants.find((f) => f.until < localParts(ev.case.openedAt, tz).date);
    c.add("note", `A separate case, ${o.number} (opened ${fmtDate(o.openedAt, tz)}), also concerns ${ev.subjectLabel}${former && localParts(o.openedAt, tz).date <= former.until ? `. It dates from when ${former.name} lived there (moved out ${fmtDate(`${former.until}T12:00:00Z`, tz)}) and is not part of this case` : ""}.`);
  }
  draft.claims = c.out;
  draft.headline = `${ev.case.number} · ${ev.case.title}: ${plural(ev.complaints.length, "report")} since ${fmtDate(first.occurredAt, tz)}, ${plural(ev.investigations.length, "staff check")}, ${ev.direct.length ? `${plural(ev.direct.length, "direct staff observation")}` : `no direct staff observation at ${ev.subjectLabel}`}${ev.unanswered.length ? `, ${plural(ev.unanswered.length, "email")} unanswered` : ""}.`;
  draft.actions = caseActions(ctx, ev);
  return draft;
}

// ---------------------------------------------------------------- request cases (keys, installations, …)

export function composeRequestStatus(ctx: AccessContext, ev: CaseEvidence, intent = "status"): Draft {
  if (ev.complaints.length && intent === "status") {
    const d = composeCaseOverview(ctx, ev);
    return { ...d, intent };
  }
  const tz = ctx.timezone;
  const draft = base(ev, intent);
  const c = new Claims();
  const first = ev.requests[0] ?? ev.followUps[0] ?? ev.confirmed[0];
  const stated = first?.claims.filter((x) => x.classification === "statement").map((x) => `"${x.text}"`).slice(0, 2) ?? [];
  if (first) c.add("statement", `${first.reporter ?? "The resident"}${first.reporterUnit ? ` (${first.reporterUnit})` : ""} made the request on ${fmtDateTime(first.occurredAt, tz)}${first.recordedBy ? `, recorded by ${who(first.recordedBy)}` : ""}.${stated.length ? ` As recorded: ${stated.join(" ")}` : ""}`, [first.sourceId]);

  const decisionItems = ev.confirmed.filter((i) => i.type === "approval_decision" || i.type === "approval_request");
  if (!ev.approvals.length) c.add("missing_evidence", "No approval request is on record for this case.");
  for (const a of ev.approvals) {
    const src = srcOf(decisionItems);
    if (a.status === "pending") c.add("documented_action", `"${a.title}" was submitted for approval by ${a.requesterName ?? "staff"} on ${fmtDateTime(a.requestedAt, tz)} and is waiting for a manager's decision.`, src);
    else c.add("documented_action", `"${a.title}" was ${a.status} by ${a.deciderName ?? "a manager"} on ${fmtDateTime(a.decidedAt, tz)}.${a.decisionNote ? ` Decision note: "${a.decisionNote}"` : ""}`, src);
    if (a.neededBy) c.add("statement", `The request is recorded as needed by ${fmtDateTime(a.neededBy, tz)}.`, src);
  }
  for (const w of ev.workOrders) {
    const src = srcOf(ev.confirmed.filter((i) => i.workOrderId === w.id));
    const open = !["completed", "cancelled"].includes(w.status);
    c.add("documented_action", `Work order ${w.number} (${w.title}) is ${w.status.replace("_", " ")}${w.assigneeName ? `, assigned to ${w.assigneeName}` : ", not assigned"}${open ? (w.eta ? `, with an ETA of ${fmtDateTime(w.eta, tz)}` : ", with no ETA on file") : w.completedAt ? `, completed ${fmtDateTime(w.completedAt, tz)}` : ""}.`, src);
  }
  if (!ev.workOrders.length && ev.approvals.some((a) => a.status === "approved")) c.add("missing_evidence", "No work order is linked to this case.");
  if (ev.followUps.length) c.add("documented_action", `The resident has followed up ${plural(ev.followUps.length, "time")}: ${list(ev.followUps.map((f) => `${fmtDate(f.occurredAt, tz).replace(/, \d{4}$/, "")} (${f.channel === "email" ? "email" : `at the desk, recorded by ${f.recordedBy?.name ?? "staff"}`})`))}.`, srcOf(ev.followUps));
  for (const u of ev.unanswered) c.add("missing_evidence", `The ${fmtDate(u.occurredAt, tz)} email ("${u.summary}") has no recorded reply.`, [u.sourceId]);
  const asked = ev.confirmed.filter((i) => i.type === "maintenance_update_request");
  const openWo = ev.workOrders.find((w) => !["completed", "cancelled"].includes(w.status));
  if (asked.length) c.add("documented_action", `An update was requested from maintenance on ${list(asked.map((a) => fmtDateTime(a.occurredAt, tz)))}.`, srcOf(asked));
  else if (openWo) c.add("missing_evidence", "No update request to maintenance is recorded in Threadline.");
  if (ev.policy) c.add("note", `Governing policy: ${ev.policy.title}, version ${ev.policy.version} (approved).`, ev.policy.sourceRecordId && ev.sources.some((s) => s.id === ev.policy!.sourceRecordId) ? [ev.policy.sourceRecordId] : []);

  const a = ev.approvals.at(-1);
  draft.claims = c.out;
  draft.headline = `${ev.case.number} · ${ev.case.title}: ${a ? `approval ${a.status}` : "no approval on record"}; ${openWo ? `${openWo.number} ${openWo.status.replace("_", " ")}, ${openWo.eta ? `ETA ${fmtDateTime(openWo.eta, tz)}` : "no ETA"}` : ev.workOrders.length ? `${ev.workOrders.at(-1)!.number} ${ev.workOrders.at(-1)!.status}` : "no work order yet"}${ev.followUps.length ? `; resident followed up ${plural(ev.followUps.length, "time")}` : ""}.`;
  draft.actions = caseActions(ctx, ev);
  return draft;
}

// ---------------------------------------------------------------- focused follow-ups

export function composeObservation(ctx: AccessContext, ev: CaseEvidence): Draft {
  const tz = ctx.timezone;
  const draft = base(ev, "observation_check");
  const c = new Claims();
  const t = topicPhrase(ev);
  for (const i of ev.investigations) c.add("staff_observation", `${checkLine(i, tz)}.`, [i.sourceId]);
  const deskSense = ev.complaints.flatMap((i) => i.claims.filter((x) => x.classification === "staff_observation").map((x) => ({ i, x })));
  for (const { i, x } of deskSense) c.add("staff_observation", `${fmtDate(i.occurredAt, tz)} — ${i.recordedBy?.name ?? "desk staff"}, at the desk: "${x.text}"`, [i.sourceId]);
  if (!ev.investigations.length) c.add("missing_evidence", "No staff check is recorded for this case.");
  draft.timeline = ev.investigations;
  draft.claims = c.out;
  draft.headline = ev.direct.length
    ? `Yes — ${plural(ev.direct.length, "check")} recorded a direct observation at ${ev.subjectLabel}.`
    : `No. Across ${plural(ev.investigations.length, "check")}, no employee recorded ${t.thing} in, or ${t.sense} from, ${ev.subjectLabel}${ev.commonAreaOdor.length ? `. One check noted a faint odor in a common area (${fmtDate(ev.commonAreaOdor[0].occurredAt, tz).replace(/, \d{4}$/, "")}), source undetermined` : ""}.`;
  draft.actions = caseActions(ctx, ev);
  return draft;
}

export function composeCorrespondence(ctx: AccessContext, ev: CaseEvidence): Draft {
  const tz = ctx.timezone;
  const draft = base(ev, "correspondence");
  const c = new Claims();
  const mail = ev.confirmed.filter((i) => i.channel === "email" || (i.type === "response" && i.channel === "app"));
  for (const m of mail) {
    if (m.direction === "outbound") c.add("documented_action", `${fmtDateTime(m.occurredAt, tz)} — ${m.respondedBy?.name ?? "Management"} sent "${m.summary}".`, [m.sourceId]);
    else c.add(m.type === "resident_statement" ? "statement" : "allegation", `${fmtDateTime(m.occurredAt, tz)} — ${m.reporter ?? "Resident"} wrote "${m.summary}"${ev.unanswered.includes(m) ? " — no recorded reply" : ""}.`, [m.sourceId]);
  }
  if (!mail.length) c.add("missing_evidence", ev.hiddenCount ? "No email in this case is visible to your role." : "No email is linked to this case.");
  const out = mail.filter((m) => m.direction === "outbound");
  draft.timeline = mail;
  draft.claims = c.out;
  draft.headline = `${plural(out.length, "message")} sent by management or staff; ${plural(ev.inbound.length, "email")} received from the resident, ${ev.unanswered.length ? `${ev.unanswered.length} with no recorded reply (${list(ev.unanswered.map((u) => fmtDate(u.occurredAt, tz).replace(/, \d{4}$/, "")))})` : "all with a recorded reply"}.`;
  draft.actions = caseActions(ctx, ev);
  return draft;
}

const DAYPART: Record<string, [number, number]> = { morning: [5, 12], afternoon: [12, 17], evening: [17, 23], night: [23, 29] };

export function composeWhoOnShift(ctx: AccessContext, ev: CaseEvidence, q: ParsedQuestion): Draft {
  const tz = ctx.timezone;
  const draft = base(ev, "who_on_shift");
  const c = new Claims();
  const inPart = (i: TimelineItem) => {
    const p = localParts(new Date(i.occurredAt), tz);
    if (q.dateIso && p.date !== q.dateIso) return false;
    if (!q.daypart) return true;
    const [a, b] = DAYPART[q.daypart];
    const h = p.hour < 5 ? p.hour + 24 : p.hour;
    return h >= a && h < b;
  };
  const desk = ev.confirmed.filter((i) => ["complaint_report", "request", "follow_up", "investigation"].includes(i.type) && i.channel !== "email" && inPart(i));
  const reports = desk.filter((i) => i.type !== "investigation");
  for (const r of reports) {
    const at = new Date(r.occurredAt).getTime();
    const chk = ev.investigations.find((v) => new Date(v.occurredAt).getTime() >= at && new Date(v.occurredAt).getTime() - at <= 3 * 3600_000);
    const duty = r.onDuty ? `${who(r.onDuty)} was on the ${r.onDuty.shift.toLowerCase()} desk${r.onDuty.coverage === "temp_cover" ? " as temp cover" : ""}` : "no desk assignment is on the roster for that time";
    const rec = r.recordedBy && r.recordedBy.id !== r.onDuty?.id ? `; the entry was written by ${who(r.recordedBy)}` : "";
    const late = r.lateEntry && r.recordedAt ? ` (late entry, written ${fmtDateTime(r.recordedAt, tz)})` : "";
    const inv = chk ? `${who(chk.investigatedBy)} checked at ${fmtTime(chk.occurredAt, tz)}${chk.outsideShift ? ", outside a scheduled shift" : ""}` : "no check is recorded at the time";
    c.add("documented_action", `${fmtDateTime(r.occurredAt, tz)}: ${duty}${rec}${late}; ${inv}.`, uniq([r.sourceId, ...(chk ? [chk.sourceId] : [])]));
  }
  if (!reports.length) c.add("missing_evidence", `No front-desk record in this case falls ${q.dateIso ? `on ${fmtDate(`${q.dateIso}T12:00:00Z`, "UTC")}` : "in that part of the day"}.`);
  c.add("note", "Shift attribution comes from the roster and the log entries themselves. It shows who handled each step of this matter; it is not an attendance or performance record.");
  draft.timeline = desk;
  draft.claims = c.out;
  const names = uniq(reports.map((r) => r.onDuty?.name).filter(Boolean) as string[]);
  draft.headline = reports.length ? `${q.daypart ? `${q.daypart[0].toUpperCase()}${q.daypart.slice(1)} reports` : "Desk reports"} in ${ev.case.number}: ${plural(reports.length, "occasion")}. On the desk: ${list(names)}.` : `No matching desk record in ${ev.case.number}.`;
  if (reports[0]) draft.focus = { ...draft.focus, dateIso: localParts(new Date(reports[0].occurredAt), tz).date };
  return draft;
}

export function composeShowSource(ctx: AccessContext, ev: CaseEvidence, q: ParsedQuestion): Draft {
  const tz = ctx.timezone;
  const draft = base(ev, "show_source");
  const lower = q.text.toLowerCase();
  let pool = ev.items;
  if (/inspection|check|investigat/.test(lower)) pool = ev.investigations;
  else if (/work order|\bwo\b/.test(lower)) pool = ev.items.filter((i) => i.type.startsWith("work_order"));
  else if (/photo|recording|video|attachment|audio/.test(lower)) pool = ev.media;
  else if (/email|reply|letter|notice/.test(lower)) pool = ev.items.filter((i) => i.channel === "email" && (/management|we sent|reply|notice|sent/.test(lower) ? i.direction === "outbound" : true));
  else if (/note|entry|log/.test(lower)) pool = ev.items.filter((i) => i.channel !== "email" && i.channel !== "work_order" && i.channel !== "app");
  if (q.dateIso) pool = pool.filter((i) => localParts(new Date(i.occurredAt), tz).date === q.dateIso);
  if (/\bfirst\b|\bearliest\b/.test(lower)) pool = pool.slice(0, 1);
  if (/\blast\b|\blatest\b|\bmost recent\b/.test(lower)) pool = pool.slice(-1);
  const c = new Claims();
  for (const i of pool) c.add(i.type === "investigation" ? "staff_observation" : i.direction === "outbound" ? "documented_action" : i.type === "complaint_report" ? "allegation" : "note", `${fmtDateTime(i.occurredAt, tz)} — ${i.typeLabel}${i.investigatedBy ? ` by ${i.investigatedBy.name}` : i.recordedBy ? `, recorded by ${i.recordedBy.name}` : ""}: "${i.claims.map((x) => x.text).join(" ").slice(0, 400)}"`, [i.sourceId]);
  if (!pool.length) c.add("missing_evidence", "No record of that kind is linked to this case in the sources you can access.");
  draft.timeline = pool;
  draft.claims = c.out;
  draft.headline = pool.length ? `${plural(pool.length, "matching record")} in ${ev.case.number}. Select a source to open the original.` : `Nothing matching in ${ev.case.number}.`;
  draft.openSourceId = pool.length ? pool.at(-1)!.sourceId : null;
  return draft;
}

export function composeSummary(ctx: AccessContext, ev: CaseEvidence): Draft {
  const full = ev.complaints.length ? composeCaseOverview(ctx, ev) : composeRequestStatus(ctx, ev);
  const tz = ctx.timezone;
  const c = new Claims();
  const keep = full.claims.filter((x, i) => i < 2 || ["staff_observation", "statement"].includes(x.classification)).slice(0, 5);
  for (const k of keep) c.add(k.classification, k.text, k.sourceIds);
  if (ev.openItems.length) c.add("note", `Outstanding: ${ev.openItems.slice(0, 4).map((o) => o.text).join(" ")}`, uniq(ev.openItems.slice(0, 4).flatMap((o) => o.sourceIds)));
  const unc = ev.gaps.filter((g) => g.kind !== "coverage").slice(0, 2);
  if (unc.length) c.add("missing_evidence", `Uncertain or missing: ${unc.map((g) => g.text).join(" ")}`, uniq(unc.flatMap((g) => g.sourceIds)));
  if (ev.legalHold) c.add("note", `A legal hold was placed on this case on ${fmtDate(ev.legalHold.placedAt, tz)}; its records are preserved regardless of retention schedules.`);
  return { ...full, intent: "case_summary", claims: c.out, headline: `Handoff summary — ${full.headline}` };
}
