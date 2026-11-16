# Threadline

**Ask your building what happened — and see the records behind the answer.**

Threadline is an evidence-first operational memory for residential buildings. It imports the
shift logs, emails, work orders and policies a property already has, links them into cases, and
lets authorized staff ask questions in plain language. Every statement in an answer cites the
original record, separates what a resident reported from what staff observed, and says what the
records do not show.

> Everything in this repository runs on **synthetic data** (the fictional Riverside House).
> It is a working prototype, not yet cleared for real resident or employee data — see the launch
> gate in `docs/PRIVACY_SECURITY.md`.

## Run it

Requirements: Node 22+. PostgreSQL 16 is recommended; without it Threadline uses an embedded database.

```bash
npm install
cp .env.example .env.local     # optional: set DATABASE_URL for PostgreSQL
npm run reset                  # creates the schema and imports the synthetic building (~3 s)
npm run dev                    # http://localhost:3000
```

Sign in from the demo account list (password for all: `threadline-demo`).

### A five-minute tour

1. **Priya Raman (community manager)** → click the first example question about cigarette smoke near
   12B. Open a source chip (`S1`), look at *Gaps & open items*, ask *"Who was working that afternoon?"*
2. Click **Generate Case Packet**, confirm the review box, preview and download the PDF.
3. **Michael Torres (concierge)** → *"What's happening with Carter's replacement key?"* →
   **Request maintenance update** → review and send.
4. **Luis Ortega (maintenance)** → Work orders → WO-2057 → set a status and ETA.
5. **Sam Okoye (temp concierge)** → ask about hanging a 60 lb mirror → **Create review request**;
   then as Priya, decide it under Approvals.
6. **Sam** → Handoffs → publish; **Angela Brooks** → acknowledge.
7. **Dana Kim (new manager)** → *"What should I know about this property?"*
8. **Marcus Bell (admin)** → Data & Privacy: sources, AI provider policy, retention, export, audit log.
9. Press the microphone on Ask (Chrome/Edge) to dictate; **Read aloud** speaks the verified answer.

## Credentials

Nothing is required. Each key below unlocks one optional capability; put them in `.env.local`
(never in chat, code or docs).

| Variable | Unlocks | Without it |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 16 / Supabase | embedded PGlite under `.data/` |
| `SESSION_SECRET` | stable sessions (required in production) | a random secret stored in `.data/` |
| `ANTHROPIC_API_KEY` | AI-written answer narrative (still verified claim by claim) | answers composed deterministically from records |
| `OPENAI_API_KEY` | server-side transcription and speech | the browser's own speech recognition and synthesis |

An administrator must also allow the provider under **Data & Privacy → AI providers**.

## What is real, simulated, or waiting on a credential

See `docs/IMPLEMENTATION.md` for the full list. In short: ingestion, case linking, the evidence
engine, verification, workflows, permissions, PDF packets, data controls and audit are implemented
and tested. Outbound email delivery and the "live sync" connector are simulated. The Claude
narrative and OpenAI voice adapters are implemented but have not been run against the live APIs.

## Tests

```bash
npm test                         # 87 tests on PostgreSQL (or: npm run test:pglite)
npm run test:e2e -- --trace off  # 13 browser tests against a production build
npm run eval                     # 30-case answer key, 14 adversarial
```
