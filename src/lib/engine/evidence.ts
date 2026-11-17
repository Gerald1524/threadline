/**
 * Evidence assembly. Everything here is computed from records the caller is allowed to see,
 * re-read from the database on every question. Counts, dates and attribution come from
 * structured rows; nothing in this file calls a model.
 */
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { can, scopeOf, visibleScope, type AccessContext } from "../access";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { CATEGORY_LABEL, OUTCOME_LABEL } from "../ingest/lexicon";
import { fmtDate, fmtDateTime, fmtTime, localParts } from "../util/time";
import { EVENT_TYPE_LABEL, type Classification, type CoverageNote, type Fact, type Gap, type Person, type SourceRef, type TimelineItem } from "./types";

type EventRow = typeof t.events.$inferSelect;
const HOUR = 3600_000;

export type Lookups = {
  people: Map<string, Person>;
  unitLabel: Map<string, string>;
  residents: Map<string, { name: string }>;
  duty: Map<string, { shift: string; coverage: string }>;
  scheduled: { userId: string; startsAt: Date; endsAt: Date }[];
  sources: Map<string, typeof t.dataSources.$inferSelect>;
};

export async function loadLookups(ctx: AccessContext): Promise<Lookups> {
  const db = await getDb(ctx);
  const us = await db.select().from(t.users).where(eq(t.users.orgId, ctx.orgId));
  const units = await db.select().from(t.units).where(scopeOf(ctx, t.units));
  const res = await db.select().from(t.residents).where(scopeOf(ctx, t.residents));
  const assigns = await db.select({ a: t.shiftAssignments, d: t.shiftDefinitions }).from(t.shiftAssignments).innerJoin(t.shiftDefinitions, eq(t.shiftDefinitions.id, t.shiftAssignments.shiftDefinitionId)).where(scopeOf(ctx, t.shiftAssignments));
  const srcs = await db.select().from(t.dataSources).where(scopeOf(ctx, t.dataSources));
  return {
    people: new Map(us.map((u) => [u.id, { id: u.id, name: u.fullName, title: u.jobTitle, employment: u.employmentType }])),
    unitLabel: new Map(units.map((u) => [u.id, u.label])),
    residents: new Map(res.map((r) => [r.id, { name: r.fullName }])),
    duty: new Map(assigns.map(({ a, d }) => [a.id, { shift: d.name, coverage: a.coverageType }])),
    scheduled: assigns.map(({ a }) => ({ userId: a.userId, startsAt: a.startsAt, endsAt: a.endsAt })),
    sources: new Map(srcs.map((s) => [s.id, s])),
  };
}

/** Build timeline items (with claims, attribution and source refs) for a set of visible events. */
export async function buildItems(ctx: AccessContext, L: Lookups, evs: EventRow[], links: Map<string, { status: string; rationale: string }> = new Map()) {
  const db = await getDb(ctx);
  if (!evs.length) return { items: [] as TimelineItem[], sources: [] as SourceRef[] };
  const ids = evs.map((e) => e.id);
  const srIds = [...new Set(evs.map((e) => e.sourceRecordId))];
  const cls = await db.select().from(t.claims).where(and(scopeOf(ctx, t.claims), inArray(t.claims.eventId, ids))).orderBy(t.claims.ord);
  const srs = await db.select().from(t.sourceRecords).where(and(visibleScope(ctx, t.sourceRecords), inArray(t.sourceRecords.id, srIds)));
  const blobs = await db.select().from(t.blobs).where(and(scopeOf(ctx, t.blobs), inArray(t.blobs.sourceRecordId, srIds)));
  const srMap = new Map(srs.map((s) => [s.id, s]));
  const person = (id: string | null) => (id ? (L.people.get(id) ?? null) : null);
  const sorted = [...evs].filter((e) => srMap.has(e.sourceRecordId)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const sources: SourceRef[] = [];
  const labelOf = new Map<string, string>();
  for (const e of sorted) {
    if (labelOf.has(e.sourceRecordId)) continue;
    const s = srMap.get(e.sourceRecordId)!;
    const label = `S${sources.length + 1}`;
    labelOf.set(s.id, label);
    sources.push({ id: s.id, label, kind: s.kind, title: s.title, externalId: s.externalId, locator: s.locator, sourceName: L.sources.get(s.sourceId)?.name ?? "Unknown source", author: s.author, occurredAt: s.occurredAt?.toISOString() ?? null, recordedAt: s.recordedAt?.toISOString() ?? null, contentHash: s.contentHash, version: s.version, flagged: s.injectionFlag, sensitivity: s.sensitivity });
  }

  const items: TimelineItem[] = sorted.map((e) => {
    const link = links.get(e.id);
    const desk = e.channel !== "email" && e.channel !== "work_order" && e.channel !== "app";
    const duty = desk && e.onDutyUserId && e.onDutyAssignmentId ? { ...person(e.onDutyUserId)!, ...(L.duty.get(e.onDutyAssignmentId) ?? { shift: "", coverage: "" }) } : null;
    const actor = e.investigatorUserId ?? e.recorderUserId;
    const actorAt = e.investigatorUserId ? e.occurredAt : (e.recordedAt ?? e.occurredAt);
    const outsideShift = desk && !!actor && !L.scheduled.some((s) => s.userId === actor && s.startsAt <= actorAt && actorAt < s.endsAt);
    return {
      eventId: e.id, sourceId: e.sourceRecordId, type: e.type, typeLabel: EVENT_TYPE_LABEL[e.type] ?? e.type, category: e.category, channel: e.channel, direction: e.direction, summary: e.summary,
      occurredAt: e.occurredAt.toISOString(), recordedAt: e.recordedAt?.toISOString() ?? null, lateEntry: e.lateEntry, linkStatus: (link?.status as "confirmed" | "suggested") ?? "confirmed", linkRationale: link?.rationale ?? null, status: e.status,
      reporter: e.reporterName, reporterUnit: e.reporterUnitId ? (L.unitLabel.get(e.reporterUnitId) ?? null) : null, unit: e.unitId ? (L.unitLabel.get(e.unitId) ?? null) : null,
      recordedBy: desk || e.channel === "app" || e.channel === "work_order" ? person(e.recorderUserId) : null, onDuty: duty, investigatedBy: person(e.investigatorUserId),
      respondedBy: e.direction === "outbound" ? person(e.recorderUserId) : null, assignee: person(e.assigneeUserId),
      claims: cls.filter((c) => c.eventId === e.id).map((c) => ({ classification: c.classification as Classification, outcome: c.outcome, outcomeLabel: c.outcome ? (OUTCOME_LABEL[c.outcome] ?? c.outcome) : null, text: c.text, observer: c.observerUserId ? (L.people.get(c.observerUserId)?.name ?? null) : null })),
      attachments: blobs.filter((b) => b.sourceRecordId === e.sourceRecordId).map((b) => ({ blobId: b.id, filename: b.filename, mediaType: b.mediaType })),
      outsideShift, correctionOf: e.correctsEventId, workOrderId: e.workOrderId,
    };
  });
  return { items, sources };
}

export type CaseEvidence = NonNullable<Awaited<ReturnType<typeof buildCaseEvidence>>>;

export async function buildCaseEvidence(ctx: AccessContext, caseId: string, now = new Date()) {
  const db = await getDb(ctx);
  const tz = ctx.timezone;
  const [c] = await db.select().from(t.cases).where(and(eq(t.cases.id, caseId), visibleScope(ctx, t.cases)));
  if (!c) return null;
  const L = await loadLookups(ctx);
  const links = await db.select().from(t.caseEvents).where(and(scopeOf(ctx, t.caseEvents), eq(t.caseEvents.caseId, caseId), ne(t.caseEvents.linkStatus, "rejected")));
  const linkMap = new Map(links.map((l) => [l.eventId, { status: l.linkStatus, rationale: l.rationale }]));
  const linkedIds = links.map((l) => l.eventId);
  const all = linkedIds.length ? await db.select().from(t.events).where(and(scopeOf(ctx, t.events), inArray(t.events.id, linkedIds), inArray(t.events.status, ["active", "duplicate"]))) : [];
  const visible = linkedIds.length ? await db.select().from(t.events).where(and(visibleScope(ctx, t.events), inArray(t.events.id, linkedIds), inArray(t.events.status, ["active", "duplicate"]))) : [];
  const { items, sources } = await buildItems(ctx, L, visible, linkMap);
  const hiddenCount = all.length - items.length;

  const confirmed = items.filter((i) => i.linkStatus === "confirmed" && i.status === "active");
  const duplicates = items.filter((i) => i.status === "duplicate");
  const tentative = items.filter((i) => i.linkStatus === "suggested");
  const of = (type: string) => confirmed.filter((i) => i.type === type);
  const complaints = of("complaint_report");
  const investigations = of("investigation");
  const responses = confirmed.filter((i) => i.type === "response" || i.type === "notice");
  const followUps = of("follow_up");
  const requests = of("request");
  const statements = of("resident_statement");
  const src = (xs: TimelineItem[]) => [...new Set(xs.map((x) => x.sourceId))];
  const outcomes = (i: TimelineItem) => i.claims.filter((cl) => cl.classification === "staff_observation").map((cl) => cl.outcome).filter(Boolean) as string[];
  const d = (iso: string) => `${fmtDate(iso, tz)} at ${fmtTime(iso, tz)}`;

  // --- correspondence: which inbound messages have a recorded reply
  const inbound = confirmed.filter((i) => i.direction === "inbound" && i.channel === "email" && ["complaint_report", "follow_up", "request"].includes(i.type));
  const evById = new Map(visible.map((e) => [e.id, e]));
  const outbound = confirmed.filter((i) => i.direction === "outbound" && i.type === "response");
  const unanswered = inbound.filter((i) => {
    const e = evById.get(i.eventId)!;
    return !outbound.some((o) => {
      const oe = evById.get(o.eventId)!;
      if (oe.occurredAt <= e.occurredAt) return false;
      return oe.inReplyToRef === e.externalRef || (!!oe.threadKey && oe.threadKey === e.threadKey) || oe.channel === "app";
    });
  });

  // --- desk reports that nobody checked at the time
  const DESK = (i: TimelineItem) => i.channel !== "email";
  const unchecked = complaints.filter(DESK).flatMap((r) => {
    const at = new Date(r.occurredAt).getTime();
    const next = investigations.find((v) => new Date(v.occurredAt).getTime() >= at);
    if (next && new Date(next.occurredAt).getTime() - at <= 3 * HOUR) return [];
    return [{ report: r, next: next ?? null }];
  });

  // --- what staff personally observed
  const direct = investigations.filter((i) => outcomes(i).some((o) => ["smoking_observed", "odor_detected", "noise_heard"].includes(o)));
  const commonAreaOdor = investigations.filter((i) => outcomes(i).includes("odor_detected_common_area"));
  const negative = investigations.filter((i) => !direct.includes(i) && !commonAreaOdor.includes(i) && outcomes(i).some((o) => o === "no_odor_detected" || o === "no_noise_detected"));
  const denials = confirmed.filter((i) => i.claims.some((cl) => cl.outcome === "denial"));

  // --- facts corroborated by records from two different authors
  const corroborated: { text: string; sourceIds: string[] }[] = [];
  for (const r of complaints.filter(DESK)) {
    const mail = complaints.find((m) => m.channel === "email" && m.reporter && m.reporter === r.reporter && Math.abs(new Date(m.occurredAt).getTime() - new Date(r.occurredAt).getTime()) <= 36 * HOUR);
    if (mail && r.recordedBy) corroborated.push({ text: `That ${r.reporter} raised this on ${fmtDate(r.occurredAt, tz)} is supported by both the front-desk log (${r.recordedBy.name}) and the resident's own email of ${fmtDate(mail.occurredAt, tz)}.`, sourceIds: [r.sourceId, mail.sourceId] });
  }
  for (const s of statements) {
    const e = evById.get(s.eventId)!;
    const parent = outbound.find((o) => evById.get(o.eventId)!.externalRef === e.inReplyToRef);
    if (parent) corroborated.push({ text: `That management's ${fmtDate(parent.occurredAt, tz)} notice reached ${s.reporter} is supported by the resident's reply of ${fmtDate(s.occurredAt, tz)}.`, sourceIds: [parent.sourceId, s.sourceId] });
  }

  // --- related operational records
  const wos = await db.select().from(t.workOrders).where(and(scopeOf(ctx, t.workOrders), eq(t.workOrders.caseId, caseId))).orderBy(t.workOrders.createdAt);
  const aps = await db.select().from(t.approvals).where(and(scopeOf(ctx, t.approvals), eq(t.approvals.caseId, caseId))).orderBy(t.approvals.requestedAt);
  const msgs = await db.select().from(t.messages).where(and(scopeOf(ctx, t.messages), eq(t.messages.caseId, caseId)));
  const [hold] = await db.select().from(t.legalHolds).where(and(scopeOf(ctx, t.legalHolds), eq(t.legalHolds.caseId, caseId), isNull(t.legalHolds.releasedAt)));
  const reviews = can(ctx, "review.read") ? await db.select().from(t.reviewItems).where(and(scopeOf(ctx, t.reviewItems), eq(t.reviewItems.status, "open"), or(eq(t.reviewItems.caseId, caseId), linkedIds.length ? inArray(t.reviewItems.eventId, linkedIds) : undefined))) : [];
  const [policy] = await db.select({ p: t.policies, v: t.policyVersions }).from(t.policies).innerJoin(t.policyVersions, eq(t.policyVersions.policyId, t.policies.id)).where(and(scopeOf(ctx, t.policies), eq(t.policies.category, c.category), eq(t.policyVersions.status, "approved")));

  // --- occupancy of the subject unit (current versus former occupants)
  const stays = c.unitId ? await db.select({ s: t.residencies, r: t.residents }).from(t.residencies).innerJoin(t.residents, eq(t.residents.id, t.residencies.residentId)).where(and(scopeOf(ctx, t.residencies), eq(t.residencies.unitId, c.unitId))) : [];
  const openedIso = localParts(c.openedAt, tz).date;
  const occupant = stays.find(({ s }) => s.startDate <= openedIso && (!s.endDate || s.endDate >= openedIso));
  const formerOccupants = stays.filter(({ s }) => s.endDate && s.endDate < openedIso);
  const otherCases = c.unitId ? await db.select().from(t.cases).where(and(visibleScope(ctx, t.cases), eq(t.cases.unitId, c.unitId), eq(t.cases.category, c.category), ne(t.cases.id, c.id))) : [];

  // --- source coverage
  const jobs = await db.select().from(t.ingestJobs).where(and(scopeOf(ctx, t.ingestJobs), eq(t.ingestJobs.status, "failed")));
  const coverage: CoverageNote[] = [...L.sources.values()].filter((s) => s.mode === "import" || s.mode === "mock_connector").flatMap((s) => {
    const failed = jobs.filter((j) => j.sourceId === s.id);
    const stale = s.coverageThrough && now.getTime() - s.coverageThrough.getTime() > 48 * HOUR && s.kind === "eml";
    let issue: string | null = null;
    if (s.status !== "active") issue = `Source is ${s.status}; new records are not being received.`;
    else if (failed.length) issue = `${failed.length} file${failed.length > 1 ? "s" : ""} failed to import (${failed.map((j) => j.filename).join(", ")}); any records in ${failed.length > 1 ? "them" : "it"} are not reflected here.`;
    else if (stale) issue = s.coverageNote ?? `Covers records through ${fmtDateTime(s.coverageThrough, tz)}; later records have not been imported.`;
    return issue ? [{ sourceId: s.id, sourceName: s.name, status: s.status, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, coverageThrough: s.coverageThrough?.toISOString() ?? null, issue }] : [];
  });

  // --- gaps, conflicts, open items
  const topic = c.category === "noise" ? "noise" : c.category === "smoke_odor" ? "smoking or smoke" : "the reported condition";
  const subjectLabel = c.unitId ? L.unitLabel.get(c.unitId)! : "the subject unit";
  const gaps: Gap[] = [];
  const isComplaintCase = complaints.length > 0;
  if (isComplaintCase && ["smoke_odor", "noise"].includes(c.category) && !direct.length) {
    gaps.push({ kind: "no_direct_observation", text: `No staff member has directly observed ${topic} in or coming from ${subjectLabel}. ${investigations.length ? `Across ${investigations.length} recorded check${investigations.length > 1 ? "s" : ""}, none did.` : "No staff check is recorded."}`, sourceIds: src(investigations) });
  }
  for (const u of unchecked) gaps.push({ kind: "not_checked", text: `The report on ${d(u.report.occurredAt)} was not checked at the time${u.next ? ` (next recorded check: ${d(u.next.occurredAt)})` : " and no later check is recorded"}.`, sourceIds: [u.report.sourceId, ...(u.next ? [u.next.sourceId] : [])] });
  for (const u of unanswered) gaps.push({ kind: "unanswered", text: `The ${fmtDate(u.occurredAt, tz)} email from ${u.reporter ?? "the resident"} ("${u.summary}") has no recorded reply.`, sourceIds: [u.sourceId] });
  const media = confirmed.filter((i) => i.attachments.length && i.direction === "inbound");
  for (const m of media) gaps.push({ kind: "unauthenticated_media", text: `${m.attachments.map((a) => a.filename).join(", ")} (${fmtDate(m.occurredAt, tz)}) was supplied by ${m.reporter ?? "the resident"}. It is kept as their submission; nothing in the records authenticates what it shows, when it was made, or its source.`, sourceIds: [m.sourceId] });
  const noKnock = investigations.filter((i) => i.claims.some((cl) => cl.outcome === "no_contact_attempt" || cl.outcome === "no_answer") && !i.claims.some((cl) => cl.outcome === "contact_made"));
  if (isComplaintCase && c.unitId && noKnock.length && ["smoke_odor", "noise"].includes(c.category)) gaps.push({ kind: "no_contact", text: `On ${noKnock.length} of ${investigations.length} checks staff did not speak with anyone in ${subjectLabel} (no answer, or no attempt recorded).`, sourceIds: src(noKnock) });
  for (const cv of coverage) gaps.push({ kind: "coverage", text: `${cv.sourceName}: ${cv.issue}`, sourceIds: [] });

  const conflicts: Gap[] = [];
  if (denials.length && complaints.length) conflicts.push({ kind: "denial", text: `${occupant ? occupant.r.fullName : "The occupant"} of ${subjectLabel} denies it (${denials.map((x) => fmtDate(x.occurredAt, tz)).join(", ")}), while ${complaints[0].reporter ?? "the complainant"} attributes it to ${subjectLabel}. The records do not resolve this.`, sourceIds: [...src(denials), complaints[0].sourceId] });
  const itemById = new Map(items.map((i) => [i.eventId, i]));
  for (const dup of duplicates) {
    const orig = itemById.get(visible.find((e) => e.id === dup.eventId)?.duplicateOfEventId ?? "");
    if (orig && Math.abs(new Date(orig.occurredAt).getTime() - new Date(dup.occurredAt).getTime()) > 10 * 60000) conflicts.push({ kind: "duplicate_time", text: `Two log entries describe the same ${fmtDate(orig.occurredAt, tz)} report but give different times (${fmtTime(orig.occurredAt, tz)} and ${fmtTime(dup.occurredAt, tz)}). It is counted once.`, sourceIds: [orig.sourceId, dup.sourceId] });
  }

  const openItems: Gap[] = [];
  for (const u of unanswered) openItems.push({ kind: "reply_needed", text: `Reply to ${u.reporter ?? "the resident"}'s ${fmtDate(u.occurredAt, tz)} email.`, sourceIds: [u.sourceId] });
  for (const w of wos.filter((w) => !["completed", "cancelled"].includes(w.status))) openItems.push({ kind: "work_order", text: `${w.number} (${w.title}) is ${w.status.replace("_", " ")}${w.eta ? `, ETA ${fmtDateTime(w.eta, tz)}` : " with no ETA"}.`, sourceIds: [] });
  for (const a of aps.filter((a) => a.status === "pending")) openItems.push({ kind: "approval", text: `"${a.title}" is waiting for a manager's decision.`, sourceIds: [] });
  for (const tItem of tentative) openItems.push({ kind: "tentative_link", text: `Possibly related, not confirmed: ${tItem.typeLabel.toLowerCase()} of ${fmtDate(tItem.occurredAt, tz)} — "${tItem.summary}"`, sourceIds: [tItem.sourceId] });
  for (const r of reviews.filter((r) => r.type !== "tentative_link")) openItems.push({ kind: "review", text: `Review needed: ${r.title}.`, sourceIds: r.sourceRecordId && sources.some((s) => s.id === r.sourceRecordId) ? [r.sourceRecordId] : [] });

  // --- headline facts (structured, exact)
  const reports = [...complaints, ...requests].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const first = reports[0] ?? confirmed[0];
  const latest = [...complaints, ...requests, ...followUps].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1) ?? confirmed.at(-1);
  const deskN = complaints.filter(DESK).length;
  const facts: Fact[] = [];
  const push = (key: string, label: string, value: string, sourceIds: string[], n?: number) => facts.push({ key, label, value, sourceIds, n });
  push("status", "Case status", c.status.replace("_", " "), []);
  if (first) push("first_report", "First report", d(first.occurredAt), [first.sourceId]);
  if (latest && latest !== first) push("latest_report", "Latest report", d(latest.occurredAt), [latest.sourceId]);
  if (complaints.length) push("complaints", "Reports received", `${complaints.length} (${deskN} to the front desk, ${complaints.length - deskN} by email)`, src(complaints), complaints.length);
  if (requests.length || followUps.length) push("follow_ups", "Resident follow-ups", String(followUps.length), src(followUps), followUps.length);
  if (isComplaintCase) {
    push("investigations", "Staff checks", String(investigations.length), src(investigations), investigations.length);
    if (["smoke_odor", "noise"].includes(c.category)) {
      push("negative_checks", c.category === "noise" ? "Checks where no noise was heard" : "Checks where no odor was detected", String(negative.length), src(negative), negative.length);
      if (c.category === "smoke_odor") push("common_area_odor", "Checks noting odor in a common area", String(commonAreaOdor.length), src(commonAreaOdor), commonAreaOdor.length);
      push("direct_observation", `Direct staff observation at ${subjectLabel}`, direct.length ? `${direct.length}` : "None recorded", src(direct), direct.length);
    }
  }
  if (inbound.length || responses.length) {
    push("responses", "Management / staff replies and notices", String(responses.length), src(responses), responses.length);
    push("unanswered", "Emails with no recorded reply", String(unanswered.length), src(unanswered), unanswered.length);
  }
  if (wos.length) push("work_orders", "Related work orders", wos.map((w) => `${w.number} (${w.status.replace("_", " ")})`).join(", "), []);
  if (tentative.length) push("tentative", "Tentative links awaiting review", String(tentative.length), src(tentative), tentative.length);

  return {
    case: c, categoryLabel: CATEGORY_LABEL[c.category] ?? c.category, subjectLabel, complainantUnit: c.complainantUnitId ? (L.unitLabel.get(c.complainantUnitId) ?? null) : null,
    complainant: c.complainantResidentId ? (L.residents.get(c.complainantResidentId)?.name ?? null) : null,
    occupant: occupant ? { name: occupant.r.fullName, since: occupant.s.startDate } : null,
    formerOccupants: formerOccupants.map(({ s, r }) => ({ name: r.fullName, until: s.endDate! })), otherCases,
    items, sources, hiddenCount, confirmed, complaints, investigations, responses, followUps, requests, statements, tentative, duplicates, inbound, unanswered, unchecked,
    direct, commonAreaOdor, negative, denials, corroborated, media, workOrders: wos.map((w) => ({ ...w, assigneeName: w.assigneeUserId ? (L.people.get(w.assigneeUserId)?.name ?? null) : null })),
    approvals: aps.map((a) => ({ ...a, deciderName: a.decidedBy ? (L.people.get(a.decidedBy)?.name ?? null) : null, requesterName: L.people.get(a.requestedBy)?.name ?? null })),
    messages: msgs, legalHold: hold ?? null, policy: policy ? { key: policy.p.key, title: policy.p.title, version: policy.v.version, versionId: policy.v.id, sourceRecordId: policy.v.sourceRecordId, effectiveFrom: policy.v.effectiveFrom } : null,
    coverage, gaps, conflicts, openItems, facts, lookups: L,
  };
}

/** Cases visible to the caller that involve a unit (as subject or as the complainant's unit). */
export async function casesForUnit(ctx: AccessContext, unitId: string) {
  const db = await getDb(ctx);
  return db.select().from(t.cases).where(and(visibleScope(ctx, t.cases), or(eq(t.cases.unitId, unitId), eq(t.cases.complainantUnitId, unitId))));
}
