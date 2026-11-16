# Architecture

A modular monolith: one Next.js 16 application, one PostgreSQL database, one private file store.

```
Browser (React 19) ── server actions / route handlers ── services ── Drizzle ── PostgreSQL 16
                                   │                        │
                                   │                        └─ blob store (private files)
                                   └─ engine (evidence → compose → verify)
                                            └─ ai/provider (policy gate) ─ optional external model
```

## Decision 1 — PostgreSQL (Supabase-compatible), not Convex

| Requirement | PostgreSQL / Supabase | Convex | Weight |
|---|---|---|---|
| Audit integrity | Triggers make `audit_log` and source content append-only inside the database, independent of application code | Enforced in function code only; no database-level immutability | High |
| Relational, exact counts | SQL joins and aggregates over events ↔ cases ↔ claims; transactions across tables | Document model with manual joins; transactional, but aggregates are hand-rolled | High |
| Tenant / property isolation | Scope predicates today; row-level security available as a second layer | Per-function checks only | High |
| Searchable source text | Built-in `tsvector` full-text; `pgvector` when embeddings are approved | Built-in full-text and vector indexes (comparable) | Medium |
| Background ingestion | Jobs table now; `pgmq`/`pg_cron` or a worker later | Scheduled functions and durable workflows built in (stronger out of the box) | Medium |
| Export / retention / exit | Standard SQL dump; customer can run Postgres anywhere; dedicated database per customer is straightforward | Export available, but the runtime is the vendor's; customer-hosted option is limited | High |
| Reactivity | Not needed for an investigative tool; pages re-render after actions | Excellent | Low |
| Development speed | Slightly slower: migrations and SQL | Faster for CRUD | Low |
| Cost and portability | Commodity; many hosts and regions | Single vendor | Medium |

**Choice: PostgreSQL 16 through Drizzle.** The product's value is defensible records, and the
controls that matter (immutability, exact relational queries, isolation, customer exit) are
database features in Postgres. Convex would be the better pick for a collaborative, real-time
product; it is the weaker fit for an audit-first one. Revisit if live multi-user editing becomes central.

`DATABASE_URL` selects PostgreSQL (local 16, Supabase, any managed host). With no URL the same
migrations run on **PGlite**, an embedded Postgres, so the app and tests work with zero setup.
The full test suite passes on both.

## Decision 2 — deterministic evidence engine, model optional

Facts, counts, dates, attribution, gaps and the PDF are computed from structured rows. A model
(Claude, via `src/lib/ai/narrate.ts`) may write the *narrative* from that evidence; each of its
statements is then verified against the stored originals and withheld if unsupported. With no
key the answer is composed from templates. This keeps the product truthful when a model is
unavailable, blocked by policy, or wrong. See `AI_RELIABILITY.md`.

One orchestrator (`engine/ask.ts`) with explicit steps and two read-only, permission-scoped
model tools (`search_records`, `read_source`). No multi-agent system: nothing in the evaluation
called for one.

## Decision 3 — rules baseline for extraction and classification

`src/lib/ingest/lexicon.ts` and `extract.ts` are transparent rules. They are the baseline a
typed-LLM or specialist classifier (Jev, OpenAI Decisions) must beat on the answer key before
adoption. None has been adopted. See `AI_PROVIDER_EVALUATION.md`.

## Modules

| Path | Responsibility |
|---|---|
| `src/lib/access.ts` | roles, capabilities, tenant/property/visibility scope predicates |
| `src/lib/auth/` | scrypt passwords, TOTP, signed session cookie; role re-read on every request |
| `src/lib/audit.ts` | append-only, hash-chained audit trail |
| `src/lib/ingest/` | parsers → extraction → linking → jobs (`INGESTION.md`) |
| `src/lib/engine/` | evidence assembly, question parsing, composers, verifier, orchestrator |
| `src/lib/services/` | workflows with state machines, idempotency and audit (`WORKFLOWS.md`) |
| `src/lib/ai/` | provider policy gate, request log, Claude narrative, OpenAI voice |
| `src/lib/connectors/` | connector contract, simulated sync, planned-connector notes |
| `src/lib/pdf/` | case packet |
| `src/lib/storage.ts` | private blob store adapter (local disk now; object storage later) |
| `src/app/` | UI pages, server actions, API routes |

## Tradeoffs accepted

- Application-layer authorization without row-level security yet (single scoped data layer,
  tested; RLS is a launch-gate item).
- Jobs run inline after submission; the jobs table is durable, but there is no separate worker.
- Keyword and structured retrieval only; no embeddings (no provider approved, and the answer
  key passes without them).
- Local-disk file store and a single app process in development.

## Deployment path

Shared multi-tenant deployment first (managed Postgres + private object storage + secret
manager). A dedicated database or customer-selected region per organization is a configuration
of the same code. A customer-hosted deployment is a possible later contractual offering, not
something this build supports.
