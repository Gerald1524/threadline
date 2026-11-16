# Data model

Schema: `src/lib/db/schema.ts`. Migrations: `drizzle/`.

## Layers

1. **Raw sources** — `source_records` (one preserved original per record and version), `blobs`
   (attachments and uploaded files). Immutable: a trigger rejects any change to `raw_text`,
   `raw_json` or `content_hash`, and any delete. `content_hash` = SHA-256 of canonical
   `{kind, text, fields}`.
2. **Derived evidence** — `events` (something that happened), `claims` (verbatim sentences from
   the source, each classified), `case_events` (event ↔ case link with status). Re-derivable
   from layer 1 at any time.
3. **Operations** — `cases`, `work_orders`, `approvals`, `policies` / `policy_versions`,
   `messages`, `handoffs` / `handoff_acks`, `reports`, `review_items`.
4. **Governance** — `audit_log`, `org_settings`, `legal_holds`, `lifecycle_requests`, `exports`,
   `provider_requests`, `data_sources`, `ingest_jobs`.
5. **Tenancy and people** — `organizations`, `properties`, `units`, `residents`, `residencies`
   (dated occupancy), `users`, `memberships`, `shift_definitions`, `shift_assignments`.
6. **AI conversation state** — `conversations`, `conversation_turns`. Separate from records;
   deleted when a cited record is disposed.

Every tenant-owned row carries `org_id` and `property_id`.

## Event semantics

| Field | Meaning |
|---|---|
| `occurred_at` | when the thing happened |
| `recorded_at` | when it was written down (`late_entry` when over an hour later or marked "Late entry") |
| `received_at`, `ingested_at` | when an email arrived; when Threadline imported it |
| `reporter_*` | who raised it (resident, with unit) |
| `recorder_user_id` | who wrote the entry |
| `on_duty_user_id` / `on_duty_assignment_id` | front-desk coverage at `occurred_at`, from the roster |
| `investigator_user_id` | who personally checked |
| `assignee_user_id`, `approver_user_id` | work-order assignee; deciding manager |
| `unit_id` / `reporter_unit_id` | the unit the matter concerns / the reporter's unit |
| `status` | `active`, `duplicate` (kept, not counted), `superseded` (older source version), `retracted` (disposed) |
| `corrects_event_id` | a correction points at the entry it corrects; the original is untouched |
| `visibility` | `staff`, `management`, `restricted` |
| `extraction_method`, `extraction_confidence` | how the event was derived |

Recorder, on-duty, and investigator are deliberately separate: Michael can record at 4:05 PM a
check Carlos made at 3:54 PM during Michael's shift, and Frank can check while on call.

## Claim classification

`allegation` (resident's report) · `staff_observation` (what an employee saw, heard, smelled;
has `observer_user_id` and an `outcome` code) · `documented_action` · `statement` (another
party's assertion, e.g. a denial) · `note`. Answers add `independently_supported`,
`tentative_link` and `missing_evidence` at composition time.

## Case links

`case_events.link_status`: `confirmed` (counts), `suggested` (shown as tentative, never
counted), `rejected`. `method`: `rule`, `thread`, `workflow`, `human`. Human decisions carry
forward when a source record is re-imported as a new version.

## Versioning and corrections

A changed upstream record → new `source_records` row (`version + 1`, `supersedes_id`), previous
row `is_current = false`, its events `superseded`. In-app actions create their own source
record (`kind = manual_entry`) so imported history and workflow share one timeline and one
provenance model.

## Audit log

`audit_log(seq, at, actor, action, entity, meta, prev_hash, hash)` per organization.
`hash = sha256(prev_hash + canonical(entry))`. Append-only by trigger. `meta` holds identifiers
and state names only, never record content (asserted in tests).

## Identifiers

Imported records and their derivatives use stable ids derived from source id + external id +
version, so re-import is idempotent. Runtime rows use prefixed random ids.
