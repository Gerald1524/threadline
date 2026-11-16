# Product

**Promise:** ask your building what happened, and see the records behind the answer.

**Customer:** the property-management organization or owner/operator. Its administrators govern
sources, access, retention, AI processing and export. Residents are not users in this release.

**Purpose boundary:** property incident, request and operational history. Staff names and shifts
appear only to show who received, recorded, checked, approved or handed off a matter. Threadline
computes no productivity, attendance or performance measures.

## Users and what each can do

| Role | Sees | Can do |
|---|---|---|
| Temp concierge | desk log, cases, work orders, policies, handoffs (no resident contact details, no management mail) | log entries, request approvals, ask maintenance for updates, hand off |
| Concierge | as above plus contact details and a property briefing | same |
| Porter / maintenance | work orders, checks, activity | update work orders, log checks |
| Superintendent | operations view, briefing, review inbox (read) | create and update work orders |
| Community manager | everything at the property including management mail and restricted records | decide approvals, resolve review items, send resident messages, generate case packets, place legal holds, import files |
| Regional / property admin | all properties in the organization | all of the above plus Data & Privacy administration |

The matrix is `ROLE_CAPS` in `src/lib/access.ts`.

## Golden scenarios (all implemented against the synthetic building)

- **A. Smoke/odor complaint and case packet** — the primary slice. Ten reports over six weeks,
  five staff checks, one common-area odor, a denial, an unanswered email, a duplicate log entry,
  two tentative links, an injected instruction, and a prior-occupant case that must stay separate.
- **B. Noise complaint with media** — resident recordings kept as their submission, not as proof.
- **C. Replacement key** — request → manager approval → work order → resident follow-ups →
  reviewed update request to maintenance → ETA → resident update.
- **D. Mirror / tool policy** — the current approved policy version, a numeric threshold check,
  a review request, and a recorded manager decision. Superseded and draft text is never authoritative.
- **E. New manager / handoff** — property briefing, unit history with former occupants, shift
  handoffs with acknowledgement by incoming (including temp) staff.
- **F. Voice** — dictate a question or an incident, review the transcript, same evidence rules,
  optional read-aloud of the verified answer.

## Out of scope for this release

Resident-facing access, a marketing site, billing, a replacement property-management CRM, live
third-party connections, and any automated decision about a resident or an employee.

## Outcomes to measure (not claimed)

Time to reconstruct a case, unanswered correspondence found, handoff items acknowledged,
unsupported-claim rate. `npm run eval` reports the ones measurable on synthetic data.
