# Workflows

All mutations go through `src/lib/services/*`. Each checks a capability, validates input,
runs in one transaction, writes an audit entry, and — where it concerns a case — adds an event
to the case timeline.

## State machines

**Case** `open → investigating | awaiting_response | resolved`; `investigating ↔ awaiting_response`;
`→ resolved → closed`; reopen from `resolved`/`closed`. Changed by: community manager, admin.

**Approval** `pending → approved | denied`. Decided once: repeating the same decision is a
no-op, a different decision is refused. The requester cannot decide their own request (admins
excepted). A denial needs a reason. Approving a key replacement creates exactly one work order
(`idempotency_key = approval:<id>`).

**Work order** `open → assigned → in_progress → completed`, with `on_hold` and `cancelled`.
`completed` and `cancelled` are terminal. Updated by: porter/maintenance, superintendent,
manager, admin.

**Message** `draft → sent | discarded`. Drafted from recorded facts (dates, status, ETA,
follow-up count), edited by a person, sent on explicit confirmation. Sending is a guarded
update, so a second click does nothing. Front desk may send to maintenance; only managers may
send to residents. **Delivery is simulated**: the message is logged on the case; nothing leaves the system.

**Review item** `open → resolved`. See `INGESTION.md`.

**Lifecycle request** `proposed → executed | rejected`. See `PRIVACY_SECURITY.md`.

## Idempotency

Client-generated keys on approval requests, message drafts and intake entries; unique
constraints on `(org_id, idempotency_key)`; status-guarded updates for decisions and sends.
Tested in `tests/workflows.test.ts`.

## Human authorization

A person decides: policy exceptions, key issuance, case links that were uncertain, duplicate
merges, resident communications, case packets (review confirmation), legal holds, archival and
disposal. The assistant may prepare a draft or a pre-filled request; a deterministic service
checks permission and state before anything is recorded.

## Handoffs

`draftHandoffItems` suggests items from what is open and visible to the author (nothing from
records their role cannot see). The author edits and publishes; incoming staff acknowledge
once each. Acknowledgements show who has read it.

## Intake

Typed or dictated → preview of how it will be read (type, category, unit, reporter, classified
sentences, flags) → confirm → saved through the import pipeline with a hash and an audit entry.
