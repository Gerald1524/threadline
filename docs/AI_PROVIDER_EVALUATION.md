# AI provider evaluation

Date of this review: 2026-11-16. No provider key was available in the build environment, so
nothing below is a benchmark of a live model. This file records what was decided, what was
checked, and what remains to be checked before enabling anything.

## Runtime default

| Task | Default | Why |
|---|---|---|
| Reasoning (answer narrative) | Anthropic Claude, `claude-opus-5-5` (override with `THREADLINE_REASONING_MODEL`) | strong tool use and instruction-following; one model keeps evaluation simple |
| Classification / extraction | built-in rules | transparent, free, and passes the answer key; nothing has yet shown it needs replacing |
| Transcription / speech | the browser | zero credentials; server-side OpenAI adapter available |
| Embeddings | none | not needed to pass the answer key; no provider approved |

The reasoning call enables Anthropic's server-side refusal fallback, so a request declined by
one Claude model is retried on another Claude model within the same provider. It never falls
back to a different vendor.

## What was verified, and how

| Item | Result |
|---|---|
| Anthropic TypeScript SDK shapes (tool use, strict tools, effort, refusal handling) | checked against the SDK installed in this repo (`@anthropic-ai/sdk` 1.8); code type-checks |
| Anthropic API data retention page | loaded in part: states retained data is not used for training without permission; zero-retention is by arrangement; some features are not eligible. **Re-read in full before relying on it** |
| OpenAI developer docs (data controls, speech, Decisions) | **could not be loaded** — the host does not resolve from the build environment |
| TypeSafe docs (`docs.typesafe.ai`) | **could not be loaded** — same reason |
| `github.com/typesafe-ai/skills` | exists; describes skills for "TypeSafe's System One API" (typed decisions and probabilities). It does not mention a product named "Jev" |
| Live model behaviour, latency, cost | **not measured** |

## Jev (TypeSafe) and OpenAI Decisions

The brief asks for a comparison with a rules/LLM baseline. That comparison has **not** been run:
neither API could be verified, and no key was available. No integration code was written
against guessed endpoints. Both appear in the provider catalog as disabled adapter slots.

To run the comparison when access exists:

1. Confirm current API, input formats (text, image), stability, price, retention and region from official docs.
2. Implement each behind `ClassifierProvider` (to add) for five bounded decisions: complaint
   category, urgency signal, duplicate likelihood, sensitivity flag, link-needs-review.
3. Score each, plus a typed Claude call and the rules baseline, on the answer key and on a
   labelled set of authorized real samples. Evaluate text and image cases separately.
4. Adopt a provider for a decision only where it beats the baseline by a margin that matters,
   at acceptable cost and latency, with acceptable data terms. Its output stays a suggestion
   routed through the review inbox; permissions, case truth and approvals never depend on it.
5. Keep the rules baseline as the fallback when the provider is disabled or fails.

## Shortlist notes (to be confirmed, not asserted)

| Provider | Consider for | Check first |
|---|---|---|
| Anthropic | reasoning; typed classification | account retention settings; zero-retention eligibility of the chosen model; region |
| OpenAI | transcription, speech; reasoning alternative | endpoint-specific retention for audio; current model names (`THREADLINE_TRANSCRIBE_MODEL`, `THREADLINE_TTS_MODEL` are configurable because the defaults in code are unverified) |
| Google Gemini | reasoning alternative; multimodal | data terms by product tier; region |
| Self-hosted open-weight model | customers whose terms rule out vendor processing | extraction quality, operations cost |
| DeepSeek-hosted | — | outside the shortlist per the brief |

## Cost

Deterministic mode makes no external calls. With the model enabled, one answer is one to a few
Claude calls carrying a single case's evidence; cost per case has not been measured.
`provider_requests` records token counts per call so it can be.
