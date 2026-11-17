# Ingestion

**Receive → preserve original → extract → normalize → classify → identify entities → propose
case links → index → flag uncertainty → searchable.** Code: `src/lib/ingest/`.

## Formats that work today

| Format | Used for | Parser notes |
|---|---|---|
| CSV | Google Sheets-style shift logs; work-order exports | header aliases; detects work orders by a `WO #` column |
| XLSX | a second log with different column names | date cells read as wall-clock time |
| EML | mailbox exports | headers, threading (`In-Reply-To`, `References`), attachments |
| PDF | policies, documents | text extraction; a scanned PDF fails with a clear message (no OCR) |
| Markdown / text | policies, Google Docs exports | front matter gives policy key, version, status |
| In-app entry | typed or dictated incidents | same extraction path, previewed before saving |

## Guarantees (tested in `tests/ingest.test.ts`)

- **Idempotent.** Same file → the existing job is returned. Same record inside a different
  file → `unchanged`. Keys: `sha256(source + file)` and `(org, source, external id, version)`.
- **Versioned.** A changed row becomes version 2; version 1 and its text remain.
- **Order-independent linking.** When a case opens, earlier unlinked records are re-derived
  from their originals and offered to the linker again; email replies re-link by thread.
- **Visible failure.** Unreadable files leave a `failed` job with the error, pinned in the
  import list and retryable. Coverage gaps from failures are stated in answers.
- **Scoped.** A paused or disconnected source accepts nothing. Sensitivity classes excluded in
  settings are not stored.

## Extraction (rules baseline)

`extract.ts` splits a record into sentences and classifies each by cue patterns
(`lexicon.ts`): not-investigated statements, denials, staff actions, staff observations with
an outcome code, resident reports. A row containing both a report and a check is split into
two events with their own times. Residents are matched by surname with one-typo tolerance and
dated occupancy; staff by first name.

These rules were written for, and are evaluated on, the synthetic corpus. Real logs will be
messier: the intended next step is model-assisted typed extraction behind the same interface,
adopted only if it beats this baseline on an answer key built from real (authorized) samples.

## Case linking

Same category + same subject unit within 45 days → confirmed. Routine notes, floor-only
mentions, unidentified senders and instruction-like text → `suggested` plus a review item.
A report naming a resident but no apartment is held with no unit and no case. Two desk-log
reports from the same apartment within an hour → duplicate candidate for a human to decide.

## Review inbox

`tentative_link`, `duplicate_candidate`, `ambiguous_identity`, `sensitive_content`,
`suspected_injection`. Decisions are audited and never rewrite the source.

## Freshness

Each source shows last successful import, coverage-through, failures and status. Answers list
coverage limitations and never treat an absent record as proof of absence.

## Connectors

`src/lib/connectors/index.ts` defines `Connector.pull(cursor)`. Implemented: a **simulated**
Sheets sync that replays local fixture batches (no external service). Planned, not built:

| Target | Incremental mechanism | Before connecting |
|---|---|---|
| Microsoft 365 | Graph delta queries per folder / drive item | tenant admin consent; application access policy limiting `Mail.Read` to one shared mailbox |
| Google Workspace | Drive changes feed with saved page token; Sheets reads; Gmail history | least-privilege scopes; `gmail.readonly` is a restricted scope needing Google verification |
| BuildingLink, Yardi, AppFolio, … | vendor API where supported, otherwise authorized exports | written authorization from customer and platform |

Scheduling: by default a job runs inline on submit or "Sync now". With `THREADLINE_JOB_MODE=worker`
an upload is only queued, and `npm run worker` (one or more processes) drains the queue. Each
job is claimed atomically, so it is processed once; a job left running by a stopped process is
re-queued after 10 minutes, or marked failed once it has used its attempts. The worker also
syncs every active connector source whose last sync is older than
`THREADLINE_SYNC_INTERVAL_MINUTES` (default 15), claiming each source atomically; paused and
disconnected sources are skipped. Each job is processed under its own organization's
row-level-security scope.
