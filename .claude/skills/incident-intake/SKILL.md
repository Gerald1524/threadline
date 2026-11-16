---
name: incident-intake
description: Use when changing how incidents are entered, parsed or classified (shift-log rows, in-app or dictated entries, extraction rules).
---

# Incident intake

Code: `src/lib/services/intake.ts`, `src/lib/ingest/extract.ts`, `src/lib/ingest/lexicon.ts`.

1. Every entry goes through `ingestRecords`; never insert events directly.
2. Sentences are quoted verbatim into `claims`. Do not paraphrase or merge them.
3. Keep the order of checks in `classifySentence`: not-investigated → denial → staff action →
   staff observation → resident report. Reordering changes meanings.
4. A new cue or category needs: a unit test in `tests/unit.test.ts`, a corpus row that
   exercises it, and an answer-key case if it affects counts.
5. Event time, record time and on-duty coverage stay separate fields.
6. Uncertain identity → review item, no unit, no case. Never guess an apartment.
7. Run `npm run reset && npm run eval`; all cases must still pass.
