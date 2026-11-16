/**
 * Ask Your Building — one orchestrator, explicit steps:
 *   authorize -> parse -> resolve identities -> retrieve evidence -> compose
 *   -> (optional model narrative) -> verify every claim -> persist the turn.
 * Permissions are re-checked and records re-read on every question, including follow-ups.
 */
import { and, desc, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { assertCan, can, scopeOf, visibleScope, type AccessContext } from "../access";
import { audit } from "../audit";
import { authorizeProvider, logProviderRequest } from "../ai/provider";
import { claudeNarrator, type Narrator } from "../ai/narrate";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { loadDirectory } from "../ingest/directory";
import type { Directory } from "../ingest/extract";
import { CATEGORY_LABEL, isCaseCategory, maxSensitivity } from "../ingest/lexicon";
import { newId } from "../util/core";
import { localParts } from "../util/time";
import { composeCaseOverview, composeCorrespondence, composeObservation, composeRequestStatus, composeShowSource, composeSummary, composeWhoOnShift, type Draft } from "./compose";
import { composeBriefing, composePolicy, composeSearch, composeUnitHistory, sourceRefs } from "./compose-wide";
import { buildCaseEvidence, casesForUnit, type CaseEvidence } from "./evidence";
import { SOUND_ALIKE, parseQuestion, type ParsedQuestion } from "./query";
import type { Answer } from "./types";
import { verifyClaims } from "./verify";

type Focus = (typeof t.conversations.$inferSelect)["focus"];
let narratorOverride: Narrator | null | undefined;
/** Tests install a scripted narrator (or null to force deterministic mode). */
export const setNarratorForTests = (n: Narrator | null | undefined) => (narratorOverride = n);

const DET_NOTE = "Composed directly from the records. No AI model is configured, so the wording is templated; facts, counts and citations are exact.";

async function resolveCase(ctx: AccessContext, q: ParsedQuestion, focus: Focus, dir: Directory): Promise<{ caseId?: string; clarification?: { headline: string; suggestions: string[] } }> {
  const db = await getDb();
  if (q.caseNumber) {
    const [c] = await db.select().from(t.cases).where(and(visibleScope(ctx, t.cases), eq(t.cases.number, q.caseNumber)));
    if (c) return { caseId: c.id };
  }
  if (q.workOrderNumber) {
    const [w] = await db.select().from(t.workOrders).where(and(scopeOf(ctx, t.workOrders), eq(t.workOrders.number, q.workOrderNumber)));
    if (w?.caseId) return { caseId: w.caseId };
  }
  const today = localParts(new Date(), dir.timezone).date;
  const unitIds = new Set(q.units.map((u) => dir.units.get(u)!.id));
  for (const id of q.residentIds) {
    const stay = dir.residents.find((r) => r.id === id)?.stays.find((s) => s.start <= today && (!s.end || s.end >= today));
    if (stay) unitIds.add(stay.unitId);
  }
  const wantCategory = isCaseCategory(q.category) ? q.category : null;
  const rank = (c: typeof t.cases.$inferSelect) => (["closed", "resolved"].includes(c.status) ? 0 : 1) * 1e15 + c.openedAt.getTime();
  if (unitIds.size) {
    const all = (await Promise.all([...unitIds].map((u) => casesForUnit(ctx, u)))).flat();
    const pool = wantCategory ? all.filter((c) => c.category === wantCategory) : all;
    if (pool.length) return { caseId: pool.sort((a, b) => rank(b) - rank(a))[0].id };
    // Nothing for the unit as heard. Offer a similar-sounding unit rather than guessing.
    if (wantCategory && q.units.length === 1) {
      const m = q.units[0].match(/^(\d+)([A-F])$/)!;
      for (const letter of SOUND_ALIKE[m[2]] ?? []) {
        const alt = dir.units.get(`${m[1]}${letter}`);
        if (!alt) continue;
        const hit = (await casesForUnit(ctx, alt.id)).find((c) => c.category === wantCategory && c.unitId === alt.id);
        if (hit) return { clarification: { headline: `I found no ${CATEGORY_LABEL[wantCategory].toLowerCase()} case for unit ${q.units[0]}. There is one for ${m[1]}${letter}: ${hit.number} ${hit.title}. Did you mean ${m[1]}${letter}?`, suggestions: [q.text.replace(new RegExp(q.units[0], "i"), `${m[1]}${letter}`)] } };
      }
    }
    return {};
  }
  if (focus.caseId && q.refersToFocus) return { caseId: focus.caseId };
  if (wantCategory) {
    const pool = await db.select().from(t.cases).where(and(visibleScope(ctx, t.cases), eq(t.cases.category, wantCategory)));
    const open = pool.filter((c) => !["closed", "resolved"].includes(c.status));
    if (open.length === 1) return { caseId: open[0].id };
    if (open.length > 1) return { clarification: { headline: `There are ${open.length} open ${CATEGORY_LABEL[wantCategory].toLowerCase()} cases. Which one do you mean?`, suggestions: open.map((c) => `What happened with ${c.number}?`) } };
  }
  return {};
}

const FOLLOW_UPS: Record<string, string[]> = {
  smoke_odor: ["Who was working that afternoon?", "Did anyone actually smell smoke?", "Which email did management send?", "Show me the inspection note", "Summarize this for the new manager"],
  noise: ["Did anyone actually hear the noise?", "Did we reply to the resident?", "Show me the inspection note", "Summarize this for the new manager"],
};

function blank(intent: string, headline: string): Draft {
  return { intent, headline, claims: [], facts: [], timeline: [], gaps: [], conflicts: [], openItems: [], actions: [], sources: [], coverage: [], restrictedNote: null, focus: {}, caseRef: null, openSourceId: null };
}

async function route(ctx: AccessContext, q: ParsedQuestion, focus: Focus, dir: Directory, now: Date): Promise<{ draft: Draft; ev: CaseEvidence | null; suggestions: string[] }> {
  if (q.intent === "property_briefing") {
    if (!can(ctx, "briefing")) return { draft: blank("property_briefing", "A property briefing is not available to your role. Ask about a specific unit, case or work order instead."), ev: null, suggestions: [] };
    return { draft: await composeBriefing(ctx, now), ev: null, suggestions: ["What's the full history of 12B?", "What's happening with Carter's replacement key?"] };
  }
  if (q.intent === "unit_history") {
    const unit = q.units[0] ?? [...dir.units.entries()].find(([, u]) => u.id === focus.unitId)?.[0];
    if (!unit) return { draft: blank("unit_history", q.unknownUnits.length ? `There is no unit ${q.unknownUnits[0]} at ${ctx.propertyName}.` : "Which unit? For example: “What's the full history of 12B?”"), ev: null, suggestions: [] };
    return { draft: await composeUnitHistory(ctx, unit, now), ev: null, suggestions: [`What can we substantiate about the smoke complaints at ${unit}?`] };
  }
  const resolved = await resolveCase(ctx, q, focus, dir);
  if (resolved.clarification) return { draft: blank("clarification", resolved.clarification.headline), ev: null, suggestions: resolved.clarification.suggestions };
  const ev = resolved.caseId ? await buildCaseEvidence(ctx, resolved.caseId, now) : null;
  if (q.intent === "policy_lookup") return { draft: await composePolicy(ctx, q, ev), ev, suggestions: [] };
  if (!ev) {
    if (q.unknownUnits.length && !q.units.length) return { draft: blank("search", `There is no unit ${q.unknownUnits[0]} at ${ctx.propertyName}.`), ev: null, suggestions: [] };
    return { draft: await composeSearch(ctx, q), ev: null, suggestions: [] };
  }
  const suggestions = FOLLOW_UPS[ev.case.category] ?? ["Did we reply to the resident?", "Summarize this for the new manager"];
  switch (q.intent) {
    case "who_on_shift": return { draft: composeWhoOnShift(ctx, ev, q), ev, suggestions };
    case "observation_check": return { draft: composeObservation(ctx, ev), ev, suggestions };
    case "correspondence": return { draft: composeCorrespondence(ctx, ev), ev, suggestions };
    case "show_source": return { draft: composeShowSource(ctx, ev, q), ev, suggestions };
    case "case_summary": return { draft: composeSummary(ctx, ev), ev, suggestions };
    case "status": return { draft: composeRequestStatus(ctx, ev), ev, suggestions };
    default: return { draft: composeCaseOverview(ctx, ev), ev, suggestions };
  }
}

export async function ask(ctx: AccessContext, input: { question: string; conversationId?: string | null; inputMode?: "text" | "voice" }, opts: { now?: Date } = {}): Promise<{ answer: Answer; conversationId: string }> {
  assertCan(ctx, "ask");
  const started = Date.now();
  const now = opts.now ?? new Date();
  const db = await getDb();
  const question = input.question.trim().slice(0, 2000);
  if (question.length < 2) throw new Error("Ask a question about a unit, resident, case or work order.");

  // Conversation state is the user's own and scoped to the property they are working in.
  let [conv] = input.conversationId ? await db.select().from(t.conversations).where(and(eq(t.conversations.id, input.conversationId), scopeOf(ctx, t.conversations), eq(t.conversations.userId, ctx.userId))) : [];
  if (!conv) [conv] = await db.insert(t.conversations).values({ id: newId("conv"), orgId: ctx.orgId, propertyId: ctx.propertyId, userId: ctx.userId }).returning();

  const dir = await loadDirectory(db, ctx.propertyId);
  const q = parseQuestion(question, dir, now);
  const { draft, ev, suggestions } = await route(ctx, q, conv.focus, dir, now);

  // Optional model narrative, gated by the organization's provider policy.
  let mode: Answer["mode"] = "deterministic";
  let modeNote = DET_NOTE;
  let claims = draft.claims;
  let headline = draft.headline;
  let speakable: string | null = null;
  let sources = draft.sources;
  const narrator = narratorOverride === undefined ? (process.env.ANTHROPIC_API_KEY ? claudeNarrator : null) : narratorOverride;
  if (narrator && draft.claims.length && draft.intent !== "clarification") {
    const sens = draft.sources.map((s) => s.sensitivity);
    const decision = narratorOverride ? ({ allowed: true, provider: "anthropic" } as const) : await authorizeProvider(ctx, "reasoning", "anthropic", sens);
    if (!decision.allowed) {
      modeNote = `${decision.reason} This answer was composed directly from the records instead; no data was sent to an AI provider.`;
      await logProviderRequest(ctx, { provider: "anthropic", task: "reasoning", maxSensitivity: maxSensitivity(sens), status: decision.status });
    } else {
      const t0 = Date.now();
      try {
        const turns = await db.select().from(t.conversationTurns).where(eq(t.conversationTurns.conversationId, conv.id)).orderBy(desc(t.conversationTurns.createdAt)).limit(3);
        const n = await narrator(ctx, question, draft, turns.reverse().map((x) => ({ question: x.question, headline: String((x.answer as { headline?: string }).headline ?? "") })));
        if (n) {
          mode = "model";
          modeNote = `Narrative written by ${n.model} from the retrieved records. Every statement was checked against the originals; counts, timeline and gaps are computed by Threadline, not by the model.`;
          headline = n.headline;
          speakable = n.speakable;
          claims = n.claims.map((c, i) => ({ id: `m${i + 1}`, ...c }));
          if (n.extraSourceIds.length) {
            const extra = await sourceRefs(ctx, n.extraSourceIds);
            sources = [...sources, ...extra.map((s, i) => ({ ...s, label: `X${i + 1}` }))];
          }
          await logProviderRequest(ctx, { provider: "anthropic", task: "reasoning", model: n.model, maxSensitivity: maxSensitivity(sens), status: "ok", inputTokens: n.usage.inputTokens, outputTokens: n.usage.outputTokens, latencyMs: Date.now() - t0 });
        } else {
          modeNote = "The AI model did not return a usable answer, so this was composed directly from the records.";
          await logProviderRequest(ctx, { provider: "anthropic", task: "reasoning", maxSensitivity: maxSensitivity(sens), status: "error", errorCode: "no_answer", latencyMs: Date.now() - t0 });
        }
      } catch (e) {
        const code = e instanceof Anthropic.APIError ? `http_${e.status}` : (e as Error).name;
        modeNote = "The AI model could not be reached, so this was composed directly from the records.";
        await logProviderRequest(ctx, { provider: "anthropic", task: "reasoning", maxSensitivity: maxSensitivity(sens), status: "error", errorCode: code, latencyMs: Date.now() - t0 });
      }
    }
  }

  const staffNames = dir.staff.map((s) => s.fullName);
  let checked = await verifyClaims(ctx, claims, { facts: draft.facts, timeline: draft.timeline, staffNames, directObservation: !!ev?.direct.length });
  // If a model narrative loses too much to verification, fall back to the exact composer.
  if (mode === "model" && checked.filter((c) => c.verification === "unverified").length > checked.length / 2) {
    mode = "deterministic";
    modeNote = "Most of the AI model's statements could not be verified against the records, so its narrative was discarded and this answer was composed directly from the records.";
    headline = draft.headline;
    speakable = null;
    checked = await verifyClaims(ctx, draft.claims, { facts: draft.facts, timeline: draft.timeline, staffNames, directObservation: !!ev?.direct.length });
  }
  const verified = checked.filter((c) => c.verification === "verified");
  const withheld = checked.filter((c) => c.verification === "unverified");

  const answer: Answer = {
    id: newId("ans"), question, intent: draft.intent, mode, modeNote, headline, claims: verified, withheld, facts: draft.facts, timeline: draft.timeline, gaps: draft.gaps, conflicts: draft.conflicts, openItems: draft.openItems,
    actions: draft.actions, sources, coverage: draft.coverage, restrictedNote: draft.restrictedNote, focus: { ...conv.focus, ...Object.fromEntries(Object.entries(draft.focus).filter(([, v]) => v)) }, caseRef: draft.caseRef, openSourceId: draft.openSourceId, suggestions,
    speakable: speakable ?? [headline, ...verified.slice(0, 6).map((c) => c.text.replace(/"/g, ""))].join(" "),
    verification: { checked: checked.length, verified: verified.length, withheld: withheld.length }, latencyMs: Date.now() - started,
  };
  await db.transaction(async (tx) => {
    await tx.update(t.conversations).set({ focus: answer.focus }).where(eq(t.conversations.id, conv.id));
    await tx.insert(t.conversationTurns).values({ id: newId("turn"), orgId: ctx.orgId, propertyId: ctx.propertyId, conversationId: conv.id, userId: ctx.userId, question, inputMode: input.inputMode ?? "text", answer: answer as unknown as Record<string, unknown>, mode, latencyMs: answer.latencyMs });
    await audit(tx, ctx, "ask.answered", "conversation", conv.id, { intent: answer.intent, mode, caseId: answer.caseRef?.id ?? null, sources: answer.sources.length, verified: verified.length, withheld: withheld.length, inputMode: input.inputMode ?? "text" });
  });
  return { answer, conversationId: conv.id };
}
