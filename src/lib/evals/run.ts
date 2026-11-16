/** Runs the answer-key cases through the real Ask pipeline and scores them. */
import { EVAL_CASES, type EvalCase, type Expect } from "../../../evals/answer-key";
import { ask } from "../engine/ask";
import type { Answer } from "../engine/types";
import { ctxFor } from "../seed/seed";

export type EvalResult = { id: string; tags: string[]; passed: boolean; failures: string[]; latencyMs: number; claims: number; cited: number; withheld: number; checks: number };

export function check(a: Answer, e: Expect): { failures: string[]; checks: number } {
  const failures: string[] = [];
  let checks = 0;
  const expect = (ok: boolean, msg: string) => {
    checks++;
    if (!ok) failures.push(msg);
  };
  const text = [a.headline, ...a.claims.map((c) => c.text)].join("\n");
  const ext = new Map(a.sources.map((s) => [s.externalId, s.id]));
  if (e.intent) expect(a.intent === e.intent, `intent: expected ${e.intent}, got ${a.intent}`);
  for (const [key, want] of Object.entries(e.facts ?? {})) {
    const f = a.facts.find((x) => x.key === key);
    if (typeof want === "number") expect(!!f && (f.n ?? Number(f.value)) === want, `fact ${key}: expected ${want}, got ${f ? (f.n ?? f.value) : "missing"}`);
    else expect(!!f && f.value.includes(want), `fact ${key}: expected to contain "${want}", got "${f?.value ?? "missing"}"`);
  }
  for (const s of e.headlineIncludes ?? []) expect(a.headline.includes(s), `headline missing "${s}" — got "${a.headline}"`);
  for (const s of e.claimsInclude ?? []) expect(a.claims.some((c) => c.text.includes(s)), `no verified claim contains "${s}"`);
  for (const s of e.textExcludes ?? []) expect(!text.toLowerCase().includes(s.toLowerCase()), `answer must not contain "${s}"`);
  for (const s of e.gapsInclude ?? []) expect(a.gaps.some((g) => g.text.includes(s)), `no gap contains "${s}"`);
  for (const s of e.conflictsInclude ?? []) expect(a.conflicts.some((g) => g.text.includes(s)), `no conflict contains "${s}"`);
  for (const s of e.sourcesInclude ?? []) expect(ext.has(s), `source ${s} missing`);
  for (const s of e.sourcesExclude ?? []) expect(!ext.has(s), `source ${s} must not appear`);
  for (const s of e.tentativeOnly ?? []) {
    const id = ext.get(s);
    const items = a.timeline.filter((i) => i.sourceId === id);
    expect(!!id && items.length > 0 && items.every((i) => i.linkStatus === "suggested"), `${s} should appear only as a tentative link`);
    expect(!a.facts.some((f) => f.n !== undefined && f.key !== "tentative" && id && f.sourceIds.includes(id)), `${s} must not be counted in any fact`);
  }
  if (e.timelineCount !== undefined) expect(a.timeline.length === e.timelineCount, `timeline: expected ${e.timelineCount} items, got ${a.timeline.length}`);
  for (const s of e.actionsInclude ?? []) expect(a.actions.some((x) => x.label === s), `action "${s}" missing`);
  if (e.restricted !== undefined) expect(!!a.restrictedNote === e.restricted, `restricted note expected=${e.restricted}`);
  if (e.maxWithheld !== undefined) expect(a.withheld.length <= e.maxWithheld, `${a.withheld.length} claims withheld (max ${e.maxWithheld})`);
  if (e.suggestionIncludes) expect(a.suggestions.some((s) => s.includes(e.suggestionIncludes!)), `no suggestion contains "${e.suggestionIncludes}"`);
  // Universal: every cited source id must be one of the answer's listed sources.
  const listed = new Set(a.sources.map((s) => s.id));
  expect(a.claims.every((c) => c.sourceIds.every((id) => listed.has(id))), "a claim cites a source that is not listed");
  return { failures, checks };
}

export async function runCase(c: EvalCase, now: Date): Promise<EvalResult> {
  const ctx = ctxFor(c.as, c.property);
  let conversationId: string | undefined;
  let answer!: Answer;
  for (const question of c.ask) ({ answer, conversationId } = await ask(ctx, { question, conversationId }, { now }));
  const { failures, checks } = check(answer, c.expect);
  const needsSource = answer.claims.filter((x) => ["allegation", "staff_observation", "documented_action", "statement", "independently_supported", "tentative_link"].includes(x.classification));
  return { id: c.id, tags: c.tags, passed: failures.length === 0, failures, latencyMs: answer.latencyMs, claims: needsSource.length, cited: needsSource.filter((x) => x.sourceIds.length > 0).length, withheld: answer.withheld.length, checks };
}

export async function runEvals(now: Date) {
  const results: EvalResult[] = [];
  for (const c of EVAL_CASES) results.push(await runCase(c, now));
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const sum = (f: (r: EvalResult) => number) => results.reduce((n, r) => n + f(r), 0);
  return {
    results,
    summary: {
      cases: results.length, passed: results.filter((r) => r.passed).length, checks: sum((r) => r.checks), checksFailed: sum((r) => r.failures.length),
      adversarialCases: results.filter((r) => r.tags.includes("adversarial")).length, adversarialPassed: results.filter((r) => r.tags.includes("adversarial") && r.passed).length,
      evidentiaryClaims: sum((r) => r.claims), citedClaims: sum((r) => r.cited), citationSupportRate: sum((r) => r.claims) ? sum((r) => r.cited) / sum((r) => r.claims) : 1,
      unsupportedClaimsWithheld: sum((r) => r.withheld), latencyMsP50: lat[Math.floor(lat.length / 2)], latencyMsMax: lat.at(-1) ?? 0,
    },
  };
}
