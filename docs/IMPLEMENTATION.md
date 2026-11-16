# Implementation status

As of 2026-11-16. Synthetic data only.

## Verified in this build

| Check | Command | Result |
|---|---|---|
| Type-check | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Unit + integration | `npm test` (PostgreSQL 16.15) | 87 / 87 |
| Same suite, embedded engine | `npm run test:pglite` | 87 / 87 |
| Browser end-to-end, production build | `npm run test:e2e -- --trace off` | 13 / 13 |
| Answer-key evaluation | `npm run reset && npm run eval` | 30 / 30 cases, 212 / 212 checks, 14 / 14 adversarial |
| Seed / import | `npm run reset` | 62 files in about 3 s; 1 file fails by design |

Synthetic building: 84 units, 29 residents (28 current, 1 former occupant), 12 staff including 3 temps,
90 shift-log entries, 40 emails, 27 imported work orders, 13 policies (14 versions) plus a draft
document, 13 approvals, 15 cases, 5 attachment stubs. A second property and a second
organization exist for isolation tests.

## Live (implemented and exercised by tests)

- Import of CSV, XLSX, EML, PDF, Markdown/text; idempotent, versioned, failure-visible
- Rules-based extraction into events and classified claims; shift attribution; late entries
- Case linking with a human review inbox; duplicate handling; order-independent re-linking
- Ask Your Building: case overview, follow-ups with conversation context, shift attribution,
  observation check, correspondence, show-the-record, handoff summary, request status, policy
  lookup with threshold check, property briefing, unit history, search, clarification
- Per-claim verification against stored originals; withheld-claim reporting
- Source inspector with provenance, hash check, versions, corrections, attachments
- Case packet PDF with human review step, stored with a hash
- Approvals, work orders, message drafting and sending, handoffs with acknowledgement,
  typed and dictated intake, corrections, case status, legal holds
- Role, property and organization isolation; audited access to confidential records and files
- Data & Privacy: source pause/disconnect, AI provider policy by task and record class,
  retention settings, ingestion scope, proposed-then-approved archival and disposal with
  legal-hold protection and propagation, export with manifest, hash-chained audit log
- Works on PostgreSQL 16 and on embedded PGlite

## Simulated (works end to end, but stands in for something external)

| Feature | What is simulated |
|---|---|
| "Live sync" connector | replays local fixture batches; contacts no Google or Microsoft service |
| Message delivery | sent messages are logged on the case; no email or SMS is sent |
| Attachments | text stubs with media file names, not real images, audio or video |
| Voice in automated tests | the browser recognizer and synthesizer are replaced by stand-ins (no audio hardware in CI). In a real Chrome or Edge browser the microphone button uses the browser's speech recognition; this was not tested with a real microphone |
| Demo sign-in | one-click accounts for the synthetic staff |

## Implemented but not run against the real service (needs a credential)

| Feature | Needs | State |
|---|---|---|
| AI-written narrative (Claude) | `ANTHROPIC_API_KEY` + allowed in Data & Privacy | code complete and type-checked; exercised only with a scripted stand-in. **Never called the live API.** |
| Server transcription and speech (OpenAI) | `OPENAI_API_KEY` + policy set to OpenAI | code complete; never called the live API; default model names unverified |

## Not built

- Microsoft 365, Google Workspace and property-platform connectors (contracts and scope notes only)
- Jev (TypeSafe) and OpenAI Decisions classifiers, and the comparison the brief asks for (APIs could not be verified; see `AI_PROVIDER_EVALUATION.md`)
- Semantic / vector search
- Interpretation of images, audio or video content; OCR for scanned PDFs
- Row-level security in the database; SSO; MFA enrolment screen (TOTP verification exists)
- A separate job worker and scheduler (jobs run inline)
- Automatic retention enforcement; backup handling
- Resident-facing access; real email delivery

## Known limitations worth knowing before a demo

- Extraction rules and the answer key were written for the same synthetic corpus. Real logs
  will need model-assisted extraction and an answer key built from authorized real samples.
- "Independently supported" is detected for two patterns only (desk log + the resident's own
  email; a notice + the recipient's reply).
- The deterministic composer answers a fixed set of question types; anything else returns
  quoted search results and says so.
- Coverage warnings compare against the real clock, so as the synthetic dates age the mailbox
  exports will always show as stale.
- The evaluation expects a freshly seeded database; workflow actions change the expected state.

## Decisions made

1. PostgreSQL over Convex (`ARCHITECTURE.md`). PostgreSQL 16 primary; PGlite fallback.
2. Deterministic evidence engine; model narrative optional and verified.
3. Rules baseline for classification; no specialist classifier adopted without evidence.
4. In-app actions become hashed source records on the same timeline as imports.
5. Canonical (sorted-key) JSON for all hashes, after PostgreSQL `jsonb` key reordering broke
   naive hashing in testing.
6. Voice defaults to the browser; server speech only when an admin selects it.

## Suggested next milestone

1. Run the Claude narrative on the answer key with a real key; measure unsupported-claim rate,
   latency and cost per case; tune the prompt and verifier.
2. Model-assisted typed extraction behind the existing interface, scored against the rules baseline.
3. One real connector end to end (Microsoft 365 shared mailbox via Graph delta) with a pilot
   customer's written authorization.
4. Row-level security, a job worker, and the remaining launch-gate items in `PRIVACY_SECURITY.md`.
