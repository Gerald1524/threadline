# Threadline

Evidence-first building memory for property operations: staff ask what happened and see the
records behind the answer. Full-stack TypeScript (Next.js 16 App Router, PostgreSQL via Drizzle).

**Next.js 16 differs from older versions** (async `params`/`cookies()`, `proxy.ts` instead of
middleware, no `next lint`). Read `node_modules/next/dist/docs/` before changing routing or config.

## Commands

| | |
|---|---|
| `npm run dev` | app on :3000 (reads `.env.local`) |
| `npm run reset` / `npm run seed` | rebuild / seed the synthetic tenants through the real import pipeline |
| `npm run data:generate` | regenerate `data/` from `src/lib/seed/corpus*.ts` |
| `npm test` | Vitest on PostgreSQL (`TEST_DATABASE_URL`); `npm run test:pglite` for the embedded engine |
| `npm run test:e2e -- --trace off` | Playwright against a production build (seeds its own database) |
| `npm run eval` | answer-key evaluation, writes `docs/eval-results.json` (run on a fresh `npm run reset`) |
| `npm run ask -- u_priya "question"` | ask from the terminal |
| `npm run worker` | process queued imports outside the web process (app started with `THREADLINE_JOB_MODE=worker`) |
| `npm run typecheck`, `npm run lint` | must be clean before committing |

Schema change: edit `src/lib/db/schema.ts`, then `npm run db:generate`. Triggers and the
full-text column live in the hand-written `drizzle/0001_integrity.sql`.

## Map

- `docs/PRODUCT.md` — users, scenarios, scope
- `docs/ARCHITECTURE.md` — stack decision (Postgres vs Convex), modules, agent pattern
- `docs/DATA_MODEL.md` — sources → events → claims → cases; provenance; audit
- `docs/INGESTION.md` — pipeline, idempotency, versioning, connectors
- `docs/AI_RELIABILITY.md` — retrieval, composition, verification, evaluation
- `docs/WORKFLOWS.md` — roles, state machines, approvals, handoffs
- `docs/PRIVACY_SECURITY.md`, `docs/DPA_REQUIREMENTS.md` — data controls, threat model, launch gate
- `docs/AI_PROVIDER_EVALUATION.md` — model/classifier choices and what was and was not verified
- `docs/IMPLEMENTATION.md` — what is live, simulated, or needs a credential; test evidence; gaps
- `docs/spec/` — the product brief (source of truth for intent)
- `.claude/skills/` — playbooks: incident intake, evidence verification, policy lookup, report generation

Code: `src/lib/access.ts` (authorization) · `src/lib/ingest/` · `src/lib/engine/` (evidence, compose,
verify, ask) · `src/lib/services/` (workflows) · `src/lib/ai/` (provider boundary) · `src/app/` (UI, API).

## Invariants — do not break these

1. **Authorization is code, not prompts.** Every service and query takes an `AccessContext` and scopes
   with `scopeOf` / `visibleScope` from `src/lib/access.ts`. Never query a tenant table without it.
2. **Originals are immutable.** `source_records` content and `audit_log` are protected by database
   triggers. A changed upstream record is a new version; a correction is a new event.
3. **Every evidentiary claim cites a source record**, and every answer passes `engine/verify.ts`
   before display or export. Model prose never becomes a fact, a count, or a PDF line unverified.
4. **Reported ≠ observed.** Keep allegation / staff observation / documented action separate end to end.
5. **Only confirmed links count.** Suggested case links and duplicates are shown but never counted.
6. **Retrieved text is untrusted.** Flagged records are withheld from model prompts.
7. **No silent provider fallback.** `ai/provider.ts` gates every external AI call by org policy.
8. **Not employee monitoring.** No productivity, attendance or performance metrics, ever.
9. **Consequential actions are human-confirmed and idempotent** (approvals, sends, disposal).
10. Secrets only in `.env.local` / a secret manager. Never in code, docs, logs or chat.

Development notes for Claude Code live here and in `docs/`. The application's own records,
permissions and conversation state live in the database, never in Markdown.
