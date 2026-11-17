# Privacy and security

Status: synthetic data only. This document describes what the software does today and what
must be true before any real resident or employee data is introduced. It is not legal advice.

## Data inventory

| Class (`sensitivity`) | Examples | Default visibility |
|---|---|---|
| `public_policy` | approved building policies | all staff |
| `internal_ops` | routine log notes, work orders, in-app workflow | all staff |
| `resident_pi` | log entries naming a resident; contact details | all staff; contact details hidden from temps |
| `employee_pi` | staff names, roles, shift coverage | all staff, for attribution only |
| `confidential_case` | complaint email, management correspondence | source default (management mailbox → managers) |
| `highly_sensitive` | ID numbers, credentials, financial or accommodation material | restricted; flagged for review; can be excluded from ingestion |

Classification is rule-based at import and is a *suggestion*; a manager can restrict a record.
Authorization never depends on it being right: visibility is enforced separately.

## Processing flow

File or entry → private blob store → parsed → `source_records` (hashed) → events, claims,
links → full-text index. Questions read from these tables under the caller's scope. Text
leaves the system only if an organization admin has allowed an external AI provider for that
task *and* record class *and* a server credential exists; flagged records are withheld and
contact details redacted first. Speech: browser dictation is processed by the browser (some
browsers use their vendor's cloud); server transcription sends audio to the provider and stores
none. Outbound messages are simulated.

## Access control

- Session: signed, HTTP-only, SameSite cookie; role and membership re-read from the database
  on every request, so a role change or deactivation applies immediately.
- Every query on tenant data is scoped by organization and property; visibility by role
  (`staff` / `management` / `restricted`). Enforced in the service layer, never in prompts.
- Organization isolation is also enforced by PostgreSQL row-level security on every table
  (`drizzle/0002_row_level_security.sql`). Work for a signed-in person runs as the restricted
  role `threadline_app` with that person's organization set, so a query missing its filter
  returns and accepts nothing from another organization. That role cannot change or delete the
  audit log or delete originals. The app refuses to start if the role cannot be used; the
  Data & Privacy page and `/api/health` show whether isolation is enforced.
  `tests/rls.test.ts` checks every table on both database engines.
- Attachments and PDFs are served only through permission-checked, audited routes; no public URLs.
- Passwords: scrypt. Two-step verification with an authenticator app (RFC 6238): set up from
  the account page; the secret is encrypted with `THREADLINE_ENCRYPTION_KEY` (AES-256-GCM,
  bound to the user); a code is accepted only once; ten one-time recovery codes are shown once
  and stored as scrypt hashes. An administrator can require it for the whole organization:
  anyone without it is sent to set it up before any page, action or API call, and nobody can
  turn it off while it is required. One-click demo sign-in never bypasses it.
  Sign-in attempts are rate-limited in memory (per process).
- Pages are served with a same-origin Content-Security-Policy, `X-Content-Type-Options: nosniff`,
  same-origin framing only, a Permissions-Policy that allows only the microphone (voice input),
  and same-origin referrers. HTTPS and HSTS are the host's responsibility.
- Isolation tests (`tests/permissions.test.ts`, e2e): a second organization and a second
  property cannot read cases, sources, attachments, search results, timelines, reports, exports,
  audit entries, or reach another user's conversation by id.

## Threat model

| Threat | Mitigation in this build | Residual / to do |
|---|---|---|
| Cross-tenant or cross-property disclosure | single scoped data layer; PostgreSQL row-level security for organization isolation; tests across direct ids, search, timelines, reports, exports, conversations, and unfiltered queries | property-level isolation is application-only; independent penetration test |
| Account takeover | scrypt; optional or organization-required two-step verification; replay protection; recovery codes hashed; rate-limited sign-in | single sign-on; rate limit is per process, not shared across instances |
| Role over-reach inside a property | capability checks in every service; visibility on records | periodic access review process |
| Prompt injection in emails, notes, files | flagged at import; withheld from prompts; claims verified; unidentified senders only tentative | heuristics can miss novel phrasing: keep verification mandatory |
| Sensitive information disclosure to a model vendor | provider allowlist by task and class; redaction; metadata-only request log; no silent fallback | contract review of each provider's retention and training terms |
| False case associations | only rule-certain links auto-confirm; the rest need a person; duplicates never auto-merged | measure linking precision on real samples |
| Excessive agency | model has two read-only tools; all actions are human-confirmed services | keep it that way |
| Unsupported or fabricated statements | per-claim verification; deterministic facts; withheld list shown | verifier is pattern-based, not complete |
| Tampering with records | database triggers; content hashes; hash-chained audit log | backups and database admin access are deployment controls |
| Credential leakage | secrets only in environment; none in client bundle, logs or docs | secret manager in production |
| Demo sign-in left enabled | `THREADLINE_DEMO_LOGIN=0` disables it | **must be off for real data** |
| Employee-monitoring misuse | no performance, attendance or productivity views or metrics exist; attribution is per case | contractual purpose limitation |

## Retention, holds, deletion, export

- Retention is configured per record class. Records past their period are flagged for review on
  the Data & Privacy page (with the number a legal hold protects). Nothing is deleted automatically.
- An admin **proposes** an archival or disposal (class + cutoff date). The proposal shows how
  many records match and how many are protected by a legal hold. A separate explicit approval
  (typed confirmation) executes it.
- **Legal hold** on a case preserves every record linked to it, whatever the schedule.
- **Archive** hides records from search. **Disposal** tombstones the original (identity and
  hash kept for the audit trail), deletes derived claims and attachments, retracts events, and
  removes cached answers and generated packets that cite it.
- **Backups** are outside the application. Production needs a documented backup retention
  period after which disposed data is gone, and a restore procedure that re-applies disposals.
- A disconnected source stops intake; existing records stay under these rules.
- **Export**: full JSON of the organization's records with a manifest of source ids and hashes.
- Statutory access, correction or deletion rights of residents or employees, where they apply,
  are handled by the customer with Threadline's assistance (see `DPA_REQUIREMENTS.md`). The
  product neither promises unrestricted deletion nor denies that such rights can exist.

## Provider risk matrix

| Provider / task | Data sent | Status here | Must confirm before real data |
|---|---|---|---|
| Anthropic Claude — narrative | redacted evidence for one case | implemented, not run live | API retention and training terms for the account; zero-retention arrangement if required; region |
| OpenAI — transcription, speech | dictated audio; answer text | implemented, not run live | endpoint-specific retention; whether audio endpoints qualify for zero retention |
| Browser speech recognition | audio, by the browser vendor | available in supporting browsers | disclose to staff; allow admins to disable (they can) |
| Jev (TypeSafe), OpenAI Decisions — classification | n/a | not implemented | could not be verified from this environment |
| Embeddings | n/a | none | choose a provider or a self-hosted model first |

"Not used for training" is not "not retained": check each endpoint. See `AI_PROVIDER_EVALUATION.md`.

## Regulatory checklist (New York first; for counsel)

- [ ] NY SHIELD Act (GBL § 899-bb): written reasonable administrative, technical and physical safeguards
- [ ] NY breach notification (GBL § 899-aa): decision process and timelines
- [ ] NY Civil Rights Law § 52-c*2 (electronic monitoring notice): confirm whether any notice applies to the final feature set
- [ ] Recording and notice rules if voice capture is enabled or expanded
- [ ] Other states' consumer privacy laws for other deployments; tenant-screening and fair-housing implications of any downstream use
- [ ] Google restricted-scope verification / Microsoft tenant consent before any connector
- [ ] DPA and subprocessor list executed with each customer

NIST CSF 2.0 and the OWASP Top 10 for LLM Applications were used as design references. They
are not certifications.

## Incident response (runbook outline)

1. **Detect and triage** — who is on call; severity; preserve logs (audit log, provider request log, access logs).
2. **Contain** — revoke sessions (rotate `SESSION_SECRET`), pause affected sources, disable the provider in policy, rotate keys.
3. **Assess** — which organizations, record classes and individuals; was data acquired or only exposed.
4. **Decide on notification** — with counsel: SHIELD Act "private information" test, contractual deadlines, regulators, affected customers. Record the decision and reasoning.
5. **Notify and remediate** — customer first per DPA; fix root cause; add a test.
6. **Review** — written post-incident review; update this document.

## Launch gate — all required before real data

Code-complete in this build (verify again in the deployed environment):

- [x] Organization isolation enforced by PostgreSQL row-level security (`drizzle/0002`)
- [x] Two-step verification with encrypted secrets, recovery codes and an organization-wide requirement
- [x] Job worker with scheduled connector syncs (`npm run worker`)
- [x] Security headers; unauthenticated health check that reveals no data

Deployment and organizational steps:

- [ ] `THREADLINE_DEMO_LOGIN=0`; `SESSION_SECRET` and `THREADLINE_ENCRYPTION_KEY` in a secret manager
- [ ] Two-step verification required for the organization (Data & Privacy → Sign-in security), or a real identity provider
- [ ] `/api/health` reports organization isolation enforced in the deployed database; independent penetration test of tenant isolation
- [ ] Managed Postgres with encryption at rest, point-in-time recovery, tested restore
- [ ] Private object storage with encryption (replace the local-disk adapter in `src/lib/storage.ts`), backed up with the database
- [ ] Worker running in production; alerting on failed imports and on `/api/health`
- [ ] DPA, subprocessor list and provider terms reviewed by counsel
- [ ] Each connector's scopes approved by the customer's administrator
- [ ] Staff-facing notice describing what is recorded and why
- [ ] Extraction and linking evaluated on authorized real samples
- [ ] Incident-response contacts and breach decision process in place
