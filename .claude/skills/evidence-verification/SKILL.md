---
name: evidence-verification
description: Use when touching answer composition, the model narrative, or claim verification in src/lib/engine or src/lib/ai.
---

# Evidence verification

1. Facts, counts and gaps come from `engine/evidence.ts`. A composer or a model may word them; it may not compute them.
2. Every claim of class allegation, staff_observation, documented_action, statement,
   independently_supported or tentative_link must carry `sourceIds`.
3. All answers pass `verifyClaims` before display, speech or PDF. Do not add a bypass.
4. Only `confirmed` links with `status = active` are counted. Suggested and duplicate items are shown, labelled, uncounted.
5. Never write "confirmed", "verified" or "established" about conduct unless a staff observation supports it.
6. Flagged (`injection_flag`) records stay out of model prompts.
7. Adding a verifier rule: add a failing fabricated claim to `tests/verify.test.ts` first.
8. Changing wording that the answer key matches: update `evals/answer-key.ts` deliberately, and say why in the commit.
