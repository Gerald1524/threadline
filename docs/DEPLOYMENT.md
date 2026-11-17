# Running and deploying Threadline

Threadline has not yet been deployed to any hosting provider. Everything below was run on a
Linux development machine with Node 22 and PostgreSQL 16; the production build and every test
were run there and in GitHub Actions. Treat the hosting section as a plan, not a record.

## 1. Run it on your own computer

You need **Node.js 22 or newer** and **Git**. PostgreSQL is optional: without it, Threadline uses
an embedded database stored in the project folder.

```bash
git clone https://github.com/Gerald1524/threadline.git
cd threadline
npm install
cp .env.example .env.local      # your private settings file; never committed
npm run reset                   # builds the database and imports the synthetic building
npm run dev                     # then open http://localhost:3000
```

Sign in from the demo account list on the login page. Every account's password is
`threadline-demo`. All people and records are fictional.

To start over with fresh demo data at any time, stop the app and run `npm run reset` again.

## 2. Settings (`.env.local`)

Only what you need. Restart the app after changing this file.

| Variable | What it does | If empty |
|---|---|---|
| `DATABASE_URL` | Use PostgreSQL 16, e.g. `postgres://user:password@localhost:5432/threadline` | embedded database in `.data/` |
| `THREADLINE_DATA_DIR` | where the embedded database, uploaded files and development keys live | `.data` |
| `SESSION_SECRET` | signs sign-in cookies; 32+ random characters | development: generated in `.data/`; **production: refuses to start sessions** |
| `THREADLINE_ENCRYPTION_KEY` | encrypts each person's authenticator secret; 32+ random characters | development: generated in `.data/`; **production: two-step verification fails** |
| `THREADLINE_DEMO_LOGIN` | `1` shows one-click demo sign-in; set `0` before any real data | on |
| `ANTHROPIC_API_KEY` | AI-written answer narrative (each statement still verified against the records) | answers are written by the built-in composer |
| `THREADLINE_REASONING_MODEL` | which Claude model to use | `claude-opus-5-5` |
| `OPENAI_API_KEY` | server speech-to-text and read-aloud | the browser's own speech features |
| `THREADLINE_TRANSCRIBE_MODEL`, `THREADLINE_TTS_MODEL` | OpenAI model names | built-in defaults (not verified against the live API) |
| `THREADLINE_JOB_MODE` | `worker` queues uploads for `npm run worker` instead of importing inside the request | imports run immediately |
| `THREADLINE_SYNC_INTERVAL_MINUTES` | how often the worker syncs connector sources; `0` turns it off | 15 |
| `THREADLINE_WORKER_INTERVAL_MS` | how often the worker checks the queue | 3000 |

Make random values with `openssl rand -hex 32`. Keep every secret in `.env.local` locally, or in
the hosting provider's secret settings in production: never in code, documents, chat or logs.

### Adding the AI keys

1. Put `ANTHROPIC_API_KEY=...` and/or `OPENAI_API_KEY=...` in `.env.local` and restart the app.
2. Sign in as the administrator (**Marcus Bell**), open **Data & Privacy → AI providers**:
   - *Answer narrative* is set to Anthropic by default, so the Anthropic key takes effect at once.
   - *Speech to text* and *Read aloud* default to the browser. Choose OpenAI there to use that key.
3. Each provider row shows whether its key is present. Every call is logged on that page
   (metadata only: no prompts or answers are stored).

Using a key incurs charges on that provider account. Without keys everything still works.

## 3. Database

Threadline runs its migrations automatically when it first connects (`npm run db:migrate` does
the same as a separate step and reports whether organization isolation is in force).

**Organization isolation (row-level security).** Work done for a signed-in person runs as a
restricted database role named `threadline_app`, limited by PostgreSQL row-level security to that
person's organization. The migration creates this role itself when the database user may create
roles (a local superuser, Supabase's `postgres` user, Amazon RDS's master user). If it may not,
the migration stops with a message; a database administrator runs, once:

```sql
CREATE ROLE threadline_app NOLOGIN;
GRANT threadline_app TO your_app_user;
```

The app's own database user must own the tables (it runs the migrations). If the role cannot be
used, the app refuses to start rather than run without isolation. `GET /api/health` and the
**Data & Privacy** page both show whether isolation is enforced.

Local PostgreSQL set-up (once):

```sql
CREATE USER threadline WITH PASSWORD 'choose-a-password' CREATEDB;
CREATE DATABASE threadline_dev OWNER threadline;
CREATE ROLE threadline_app NOLOGIN;
GRANT threadline_app TO threadline;
```

For `npm test` on PostgreSQL also set `TEST_DATABASE_URL` to the same server's `postgres`
database (each test file gets a scratch copy).

## 4. Production

```bash
npm ci
npm run build
npm run db:migrate          # once per release, before starting app instances
npm start                   # serves on $PORT (default 3000)
npm run worker              # separate long-running process (imports queue, scheduled syncs)
```

Required: `DATABASE_URL`, `SESSION_SECRET`, `THREADLINE_ENCRYPTION_KEY`, `THREADLINE_DEMO_LOGIN=0`.
Recommended: `THREADLINE_JOB_MODE=worker` with at least one worker running.

What the host must provide:

- **PostgreSQL 16** with encryption at rest, point-in-time recovery and a tested restore.
- **A persistent disk** for `THREADLINE_DATA_DIR`. Original files (email exports, PDFs,
  attachments, generated packets) are stored there today. Serverless hosts that discard the
  disk are not suitable until the storage adapter (`src/lib/storage.ts`) is moved to private
  object storage. Back the disk up with the database: a record without its file is incomplete.
- **HTTPS** at the load balancer, with HSTS. The app sets its own security headers
  (Content-Security-Policy, nosniff, frame and permission policies) but cannot see TLS.
- **Health check**: `GET /api/health` returns 200 when the database is reachable and isolation is
  enforced, 503 otherwise. It needs no sign-in and returns no data.
- **A secret manager** for the variables above. Rotating `SESSION_SECRET` signs everyone out.
  Losing or changing `THREADLINE_ENCRYPTION_KEY` disables authenticator codes; people then sign
  in with a recovery code and set two-step verification up again.

Shapes that fit: a VM or container host with an attached volume (one web process plus one
worker), next to a managed PostgreSQL. Several web instances work: sessions are signed cookies,
and imports and syncs are claimed atomically, but the file store must then be shared, which is
another reason to move it to object storage first.

Before any real resident or employee data, complete the launch gate in
[`PRIVACY_SECURITY.md`](PRIVACY_SECURITY.md#launch-gate--all-required-before-real-data).
