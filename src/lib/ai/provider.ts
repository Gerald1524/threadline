/**
 * One boundary for every external AI call. Before any provider is contacted:
 *   - the organization's provider policy must name that provider for the task, and
 *   - the most sensitive record in the request must be in the policy's allowed classes.
 * A disallowed or unconfigured provider is never silently replaced by another one; the
 * caller falls back to the deterministic path and the reason is shown to the user.
 * Every attempt is logged as metadata only (no prompts, no outputs).
 */
import { eq } from "drizzle-orm";
import type { AccessContext } from "../access";
import { getDb } from "../db/client";
import { orgSettings, providerRequests } from "../db/schema";
import { maxSensitivity } from "../ingest/lexicon";
import { newId } from "../util/core";

export type AiTask = "reasoning" | "classification" | "transcription" | "speech" | "embeddings";

export const PROVIDER_CATALOG: Record<AiTask, { id: string; label: string; envKey?: string; external: boolean; note: string }[]> = {
  reasoning: [
    { id: "anthropic", label: "Anthropic Claude (API)", envKey: "ANTHROPIC_API_KEY", external: true, note: "Writes the narrative of an answer from retrieved evidence. Implemented; exercised only with a scripted test double in this build." },
    { id: "none", label: "None — deterministic composer only", external: false, note: "Answers are composed from structured records with templated wording." },
  ],
  classification: [
    { id: "rules", label: "Built-in rules (deterministic)", external: false, note: "Keyword and pattern rules. Evaluated baseline." },
    { id: "anthropic", label: "Anthropic Claude (typed classification)", envKey: "ANTHROPIC_API_KEY", external: true, note: "Adapter slot. Not enabled: no comparative evaluation has been run." },
    { id: "jev", label: "Jev by TypeSafe", envKey: "JEV_API_KEY", external: true, note: "Adapter slot only. Not implemented: current API could not be verified from this environment." },
    { id: "openai_decisions", label: "OpenAI Decisions", envKey: "OPENAI_API_KEY", external: true, note: "Adapter slot only. Not implemented: current API could not be verified from this environment." },
  ],
  transcription: [
    { id: "browser", label: "Browser speech recognition", external: true, note: "Runs in the employee's browser. Some browsers send audio to their vendor's cloud service." },
    { id: "openai", label: "OpenAI transcription (server-side)", envKey: "OPENAI_API_KEY", external: true, note: "Audio is sent from the server and not stored by Threadline. Implemented; not exercised live in this build." },
    { id: "none", label: "Disabled", external: false, note: "Typing only." },
  ],
  speech: [
    { id: "browser", label: "Browser speech synthesis", external: false, note: "Read aloud by the browser's built-in voices." },
    { id: "openai", label: "OpenAI text-to-speech (server-side)", envKey: "OPENAI_API_KEY", external: true, note: "Implemented; not exercised live in this build." },
    { id: "none", label: "Disabled", external: false, note: "No read-aloud." },
  ],
  embeddings: [{ id: "none", label: "None — keyword and structured retrieval", external: false, note: "Semantic vector search is deferred; pgvector is the planned store." }],
};

export const keyConfigured = (envKey?: string) => !envKey || !!process.env[envKey];

export async function getProviderPolicy(orgId: string) {
  const db = await getDb();
  const [s] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return s?.providerPolicy ?? {};
}

export type ProviderDecision = { allowed: true; provider: string } | { allowed: false; provider: string; status: "blocked_by_policy" | "not_configured"; reason: string };

export async function authorizeProvider(ctx: AccessContext, task: AiTask, wanted: string, sensitivities: string[]): Promise<ProviderDecision> {
  const policy = (await getProviderPolicy(ctx.orgId))[task];
  const entry = PROVIDER_CATALOG[task].find((p) => p.id === wanted);
  const top = maxSensitivity(sensitivities);
  if (!policy || policy.provider !== wanted) return { allowed: false, provider: wanted, status: "blocked_by_policy", reason: `Your organization's AI policy does not allow ${entry?.label ?? wanted} for ${task}.` };
  if (sensitivities.length && !policy.allowedSensitivity.includes(top)) return { allowed: false, provider: wanted, status: "blocked_by_policy", reason: `Your organization's AI policy does not allow ${task} by an external provider on records classified "${top.replace(/_/g, " ")}".` };
  if (!keyConfigured(entry?.envKey)) return { allowed: false, provider: wanted, status: "not_configured", reason: `${entry?.label ?? wanted} is allowed by policy but no credential is configured on the server.` };
  return { allowed: true, provider: wanted };
}

export async function logProviderRequest(ctx: AccessContext, r: { provider: string; task: AiTask; model?: string | null; maxSensitivity: string; status: string; inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number; errorCode?: string | null }) {
  const db = await getDb();
  await db.insert(providerRequests).values({ id: newId("prq"), orgId: ctx.orgId, userId: ctx.userId, provider: r.provider, task: r.task, model: r.model ?? null, maxSensitivity: r.maxSensitivity, status: r.status, inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null, latencyMs: r.latencyMs ?? null, errorCode: r.errorCode ?? null });
}
