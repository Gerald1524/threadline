# AI reliability

The standard is not "the answer sounds right". It is: the manager can obtain the documented
history, check each important fact against its source, and see what is uncertain.

## Pipeline (`src/lib/engine/ask.ts`)

1. **Authorize** — `ask` capability; role and membership re-read from the database.
2. **Parse** — units (including spoken forms, "twelve bee" → 12B), residents (one-typo
   tolerance), case and work-order numbers, dates, dayparts, intent.
3. **Resolve** — unit + category → case; current versus former occupants via dated occupancy.
   A unit with no matching case but a similar-sounding unit that has one produces a
   clarification, not an answer about the wrong apartment.
4. **Retrieve** — `engine/evidence.ts` assembles everything this user may see for the case:
   timeline, attribution, counts, unanswered mail, unchecked reports, denials, corroboration,
   work orders, approvals, policy, legal hold, source coverage.
5. **Compose** — deterministic composers produce typed claims citing source record ids.
6. **Narrate (optional)** — if a model is configured and allowed by policy, it rewrites the
   narrative from the same evidence and must submit claims with source labels.
7. **Verify** — every claim, from either path.
8. **Persist** — conversation turn and focus; audit entry with counts only.

## Claim verification (`engine/verify.ts`)

For each claim the verifier re-reads the cited records under the caller's permissions and checks:

1. each cited record exists, is visible to this user, and matches its stored hash
2. each quotation appears verbatim in a cited record
3. each calendar date is the date of a cited record or is written in one
4. each staff member named handled, or is named in, a cited record
5. each count attached to a counted noun equals a structured fact
6. no statement asserts confirmation ("confirmed", "established", …) that staff observations do not support

A failed claim is withheld and shown as withheld with the reason. If more than half of a
model's claims fail, its narrative is discarded and the deterministic answer is returned.
Allegations and observations with no source are always rejected.

## Untrusted content

Record text is evidence, never instruction. At import, instruction-like text is flagged
(`suspected_injection`) and queued for review. Flagged records are withheld from model prompts
(`evidenceForModel`, `read_source`), emails and phone numbers are redacted, and the system
prompt states that record text is data. Unidentified senders are linked only as `suggested`.
The synthetic corpus contains such an email; the evaluation checks it changes nothing.

## What "uncertainty" means here

Not a model confidence score. Uncertainty is stated as facts about the records: no direct
staff observation; a report not checked at the time; an email with no recorded reply; an
unauthenticated attachment; a tentative link; conflicting statements; a source that failed to
import or has not been imported past a date.

## Evaluation

`evals/answer-key.ts` holds 30 cases (14 adversarial) written from the scenario design, not from
system output: exact counts, dates, identities, source links, observed-versus-reported wording,
duplicates, tentative links, prior occupant, policy versions, missing records, incomplete
ingestion, voice ambiguity, role restrictions, cross-tenant and cross-property isolation.
`npm run eval` runs them through the real pipeline and writes `docs/eval-results.json`.

Latest run (deterministic composer, PostgreSQL 16): **30/30 cases, 212/212 checks, 14/14
adversarial; 178/178 evidentiary claims cited; 0 unsupported claims; median under 30 ms, max under 200 ms.**
Import of the 62-file corpus takes about 3 seconds.

`tests/verify.test.ts` feeds the verifier fabricated model output (wrong date, wrong count,
wrong person, invented quote, overclaim, another tenant's record) and asserts it is withheld.

### Limits of this evidence

- The answer key and the extraction rules were written by the same author for the same
  synthetic corpus. Passing shows the system is internally consistent and that the safeguards
  work on known traps; it does not measure accuracy on real building records.
- The model path has been exercised only with a scripted stand-in. Latency, cost per case and
  unsupported-claim rate with a live model are unmeasured.
- The verifier is conservative pattern matching. It catches wrong dates, counts, names, quotes
  and overclaims; it cannot catch every subtly misleading paraphrase. It reduces unsupported
  claims; it does not eliminate them.
