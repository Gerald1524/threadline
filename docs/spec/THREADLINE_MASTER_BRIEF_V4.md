# PROJECT THREADLINE
## Consolidated Claude Code Product & Engineering Brief — Version 4 (November 2026)

**Working product name:** Threadline (provisional)  
**Core promise:** *Ask your building what happened—and see the records behind the answer.*  
**Build target:** A functioning, full-stack TypeScript web application with a conversational operational agent, an auditable building memory, continuous record preparation, staff workflows, voice interaction, and report generation.

**Who pays for and governs the product:** The customer is the **property-management organization or owner/operator**, not an individual resident. Its authorized administrators control the organization’s permitted data sources, team access, organizational retention policies, integrations, processing, exports, and records lifecycle, subject to applicable law, contractual duties, and preservation requirements.

**Purpose boundary:** This is a **property incident, request, and operational history tool**, not an employee-monitoring or employee-performance analytics system. Employee/shift attribution is only to explain who received, documented, investigated, approved, or handed off an operational matter.

**Design freedom:** Keep these user problems, concrete experiences, safeguards, and acceptance results intact. Propose and implement a simpler or stronger technical solution when you can justify it; technology examples are candidates, not rigid vendor requirements.

### Your role and assignment

Act as our founding technical partner: combine the judgment of a principal software architect, senior TypeScript engineer, AI systems engineer, product designer, and reliability engineer. Turn this product vision into working software, using strong independent judgment on implementation details. Treat this brief as the product source of truth. Make reasonable technical decisions, explain important tradeoffs, implement and test the application, and document what is functional, what is simulated, and what requires an external credential.

The deliverable is **the actual employee-facing product**. A public landing page, marketing video, and lead-generation site belong to a separate future project. Its first release should be narrow, cohesive, and convincing, with the smoke-complaint investigation as the best-executed complete workflow. Design the foundations so future expansion is possible without having to build an entire replacement property-management CRM now.

## 1. Vision and customers

Residential buildings operate through thousands of small interactions: concierge shift notes, complaints, front-desk emails, management correspondence, superintendent investigations, work orders, approvals, policy exceptions, staff handoffs, and attachments. Information is scattered across staff memory, Google Docs and Sheets, email inboxes, property software, and physical or digital logs. When an issue escalates, employees manually reconstruct what happened and who did what.

**Threadline is an evidence-first, AI-assisted institutional memory for buildings.** Authorized employees can ask natural-language questions, retrieve a documented timeline, inspect the sources, understand uncertainty, and initiate the appropriate next action. It should work as a standalone web app for smaller buildings and be architected to connect to existing property systems later through authorized integrations or supported imports.

**Primary users:** community/property managers, concierges, temporary front-desk employees, resident managers/superintendents, maintenance/porters, regional managers and building owners/operators. Each has different permissions and a different operational view. Future modules may offer a limited resident-facing concierge experience, but staff operations are the first release.

**Practical results we want to demonstrate:** faster incident reconstruction; fewer lost handoffs and unanswered follow-ups; clear attribution across shifts; consistent policy answers; better maintenance and approval coordination; searchable building knowledge; and source-indexed management/legal review packets. Measure these outcomes in product evaluations rather than inventing ROI claims.

## 2. The signature product experience — Ask Your Building

Open a polished operations workspace where a manager can type or speak:

> “The resident emailed again about cigarette smoke near 12B. When did this start? Who investigated? Did we reply? What can we actually substantiate?”

The application returns a concise, conversational answer with:

- First and latest relevant reports, complaint and inspection counts, and case status.
- Chronological events from email, shift notes, work orders, and management correspondence.
- The reporting party, employee who received/recorded the report, on-duty shift, employee who investigated, and employee who responded.
- A distinction between allegations, employee observations, documented actions, independently supported facts, tentative links, and missing evidence.
- Clickable source references opening the original email, log entry, attachment, or work order.
- Outstanding follow-ups, conflicting records, missing documentation, and next-action suggestions.
- A human-reviewed **Generate Case Packet** action producing a professional downloadable PDF with a source index.

Allow follow-ups in the same conversation: “Who was working that afternoon?”, “Did anyone actually smell smoke?”, “Which email did management send?”, “Show me the inspection note”, “Summarize this for the new manager.” The AI should keep conversational context while rechecking the user's permissions and consulting current underlying records. The response can be read aloud, with the same verified facts as its written counterpart.

## 3. Data foundation: source records, events, cases, and work

Design a durable domain model that distinguishes **raw sources**, **derived events/claims**, **cases**, **employees and shifts**, **policies**, **workflows**, and **audit history**.

Key entities include organizations, properties, units, residents, employee identities and memberships, employment type, shift rosters, resident communications, source documents and attachments, events, claims, cases, approvals, work orders, policy versions, handoffs, reports, and audit records.

For every operational event, preserve as applicable: organization/property/unit/case IDs; unique source ID and source system; original text/file and stable locator; content hash; occurred-at, recorded-at, received-at, and ingested-at timestamps; timezone; reporting party; subject; creator/recorder; on-duty employee; investigator/observer; assignee; approver; employee role and permanent/temp/contractor status; shift ID and actual coverage; channel (phone, in person, email, radio, app, document, work order); event type/category; observation classification; related events; policy/version; workflow state; visibility; source permissions; and corrections.

Keep an **append-only or version-audited event trail**. An employee's later correction should be visible, not silently replace the historical record. An employee can record an incident outside their assigned shift; event time, record time, and shift coverage must remain separate. Allow building-configured shifts (for example 7 a.m.–3 p.m., 3 p.m.–11 p.m., 11 p.m.–7 a.m.) and temp coverage. A shift schedule may exist solely to accurately attribute an incident to its handling staff; it is not an employee-tracking feature. The product should not compute individual employee performance scores, surveillance timelines, productivity rankings, or employment recommendations.

Example: resident calls at 3:45 p.m. alleging smoke; concierge Michael records the call; he radios porter Carlos; Carlos investigates at 3:54 p.m., detects no hallway smoke, knocks without response, then reports back; Michael documents the result at 4:05 p.m.; the resident emails management the next day. These are **separate linked records**, including a difference between what a resident asserted and what staff personally observed.

## 4. Continuous ingestion and preparation — the work starts before the question

This is a defining capability. Rather than searching every disconnected source from scratch on every question, implement a reliable **ingestion and incremental indexing pipeline**:

**Receive → preserve original → extract → normalize → classify → identify entities → propose case links → index → flag uncertainty → make searchable.**

Initial working inputs should include manual/front-desk entry, configurable shift-log forms, CSV/XLSX imports for Google Sheets-style logs, Google Docs-style text/document exports, EML or synthetic mailbox imports, PDFs, and attachments. Preserve original filenames, version, authorship, timestamps, and provenance. Support re-import without duplicates through stable IDs/hashes and idempotent jobs. Keep failed imports visible in a retryable queue. Add a human-review inbox for ambiguous unit/resident matches, duplicate candidate cases, low-confidence extraction, and potentially sensitive content. Permit corrections without overwriting the original source or silently changing an established timeline.

Design for approved-source, scheduled or event-driven synchronization (where supported by an authorized connection): new or changed approved-source records should incrementally update the search index, event ledger, case suggestions, and staff queues. Show a source's **last successful sync**, freshness, failed updates, and coverage limitations. “No matching record was found” is not equivalent to “the event never happened,” especially when source coverage is incomplete.

Use text extraction and semantic/keyword retrieval where helpful, but store exact facts such as dates, counts, approvals, staff attribution, and work-order status in a structured data layer. The initial product must make CSV/XLSX, Google Docs-style exports, PDFs, and synthetic email files useful immediately. Plan adapters for **Microsoft 365/Outlook/SharePoint/OneDrive and Google Workspace (Docs/Sheets/Gmail)** first because these are plausible operational sources. Microsoft Graph delta queries and Google Drive change feeds are possible incremental-sync mechanisms that must be verified against each exact connector's allowed permissions. BuildingLink, Gotham, Yardi, AppFolio, and similar systems are additional adapter targets only where real supported access or authorized exports exist. Implement import contracts and adapters so they can be connected without rebuilding the product.

## 5. Intelligent query and case reconstruction

Create one primary conversational agent backed by narrowly scoped tools/functions, not a tangle of disconnected bots. Capabilities include:

1. Interpret authorized question, selected property, people, units, time ranges, and user intent.
2. Resolve identities carefully (unit 12B versus resident name, current versus former occupants, spelling variants).
3. Retrieve permitted structured data, exact keyword matches, and relevant semantic document passages.
4. Connect evidence into a chronology, preserving source IDs and timestamps.
5. Distinguish direct observations, reported claims, documented actions, interpretation, contradictions, and evidence gaps.
6. Independently validate important factual claims against the source records before display or export.
7. Return a typed, UI-friendly answer with claim-to-source links, confidence/uncertainty where justified, and suggested actions.
8. Use deterministic services to execute only approved, permission-checked actions.

A multi-step verification pass may use tools or a specialist worker when it materially improves quality; implement the simplest trustworthy design first. Treat retrieval results and uploaded text as **untrusted evidence**, not instructions for the agent. An AI may suggest a possible case association; a human should be able to approve or correct uncertain or consequential associations. Source and policy changes should invalidate stale derived results.

**Classification and decision layer:** Distinguish (a) deterministic rules, (b) typed bounded classification, (c) structured extraction, (d) multimodal image/document interpretation, (e) narrative synthesis, and (f) human authorization. Compare **Jev by TypeSafe**, **OpenAI Decisions**, and a simpler typed LLM or rules baseline for focused judgments such as complaint category, urgency signals, duplicate likelihood, sensitivity flag, routing recommendation, or whether a possible case match needs review. Both Jev and OpenAI Decisions have documented image-oriented capabilities as of November 2026; verify exact version, stability, API availability, price, latency, and image constraints before implementation. Do not assume every image classification task needs a specialized decision model, and do not force one into the MVP without a comparative test. Keep case truth, factual verification, permissions, work-order status, and approvals grounded in source evidence, database rules, and authorized humans. Include fallback behavior if the optional classifier has no key or fails. If a supplied Jev reference pack exists, use it as background context while treating current official TypeSafe documentation as authoritative.

**Agent discipline:** A single orchestrating assistant using explicit, permission-scoped tools is the default. Use source-validation routines and smaller delegated workers only where they are demonstrably useful. The agent may help the user ask follow-up questions and prepare drafts, but a deterministic service checks authorization, data freshness, idempotency, and action constraints. Answer confidence and model probability do not replace evidence or human review.

## 6. Working scenarios to implement

### A. Smoke/odor complaint and management evidence packet — primary vertical slice

Populate a fictional case spanning several weeks: repeated resident complaints, calls and emails, full-time and temporary concierge notes, staff investigations with inconclusive outcomes, one report of an odor in a common area, management replies, and no direct observation of smoking inside the accused apartment. The user asks about Unit 12B and can inspect counts, time-ordered evidence, who handled each step, original sources, missing proof, and any unanswered correspondence. Produce a clear PDF with a chronology, employee attribution, source index, attached/source-referenced evidence, and limitations for management or attorney review. It is a factual case packet, not an automated legal decision.

### B. Noise complaint and media attachment

A resident complains about recurring noise, attaches an audio/video file, and asks for an investigation. The concierge or porter checks the location and does not hear noise; another resident does not answer the door. The system links resident reports, media, investigation, and staff note without presenting the resident's recording as authenticated proof of its cause. Show who acted, when, whether an email received a response, and what follow-up remains.

### C. Replacement key approval and maintenance handoff

Resident Thomas Carter requests a key and has a time constraint. Front desk records the request; community manager approval is required; authorization is documented; a work order is created or linked; maintenance is assigned; resident follows up; the work order remains open with no ETA. A concierge asks, “What's happening with Carter's replacement key?” and receives the true current state. “Request maintenance update” creates an editable, reviewable message and a logged action. A maintenance response updates the case and staff handoff; a resident-facing draft can be prepared for human review.

### D. Mirror/tool policy and approval

A resident asks to borrow tools or have maintenance mount a heavy mirror. Building policy addresses what staff may loan or install and what needs manager review. The agent finds the **current approved policy**, explains it plainly, and can create a request for review. The manager's approval or denial is documented; a draft/interview note is not treated as authoritative policy.

### E. New manager / staff handoff

A newly hired manager asks “What should I know about this property?” or “What's the full history of 12B?” and gets an appropriately scoped briefing on open cases, recurring issues, manager decisions, work orders, staff handoffs, and unresolved items. An outgoing concierge can produce a shift handoff; incoming permanent or temp staff can acknowledge outstanding work.

### F. Voice-driven intake and follow-up

An employee dictates a new incident, reviews the transcript, confirms the record, and can later find it using natural-language voice queries. Speaking a request or follow-up must use the same evidence and action rules as typing.

## 7. Workflows, permissions, and accountability

Create functional workflows for incident intake, case linking, assignments, manager approval, work-order tracking, follow-up communications, escalation, and closing a case. Model valid states and role permissions explicitly. A human authorizes policy exceptions, key issuance, consequential resident communications, and external actions. Every decision and status transition should create an attributable audit/event entry; prevent duplicate work orders or repeated sends from repeated button clicks.

Different views are appropriate for concierge, temp concierge, porter/maintenance, superintendent/resident manager, community manager, and regional/property admin. The app should support manager and maintenance update queues, unresolved-item reminders within the application, and concise handoff summaries. Keep the event ledger accessible to authorized staff without exposing unrelated sensitive resident details.

## 8. Voice and reports

Implement voice as an integrated conversation interface: speech input/transcription, editable recognized text, grounded query execution, written answer with citations, optional speech playback, replay and accessible controls. A chained speech-to-text → evidence-backed answer → text-to-speech flow is a strong default; choose current supported APIs after verification. Make typed interaction fully usable without voice credentials. Avoid retaining raw audio by default.

Generate viewable, printable, downloadable PDF case packets: case identity; date range; relevant units; summary; chronology; reported versus observed facts; employee and shift details; management correspondence; related work orders; policy references; attachments/source index; conflicting records; known limitations; generation timestamp. Provide source links back to records when displayed in-app. A legal reviewer should be able to inspect underlying evidence before relying on the packet.

## 9. Development knowledge system and the Markdown/filesystem approach

Apply a lightweight, **filesystem-based project context system** while developing the software. Use a small `CLAUDE.md` (or `AGENTS.md` with appropriate Claude Code routing) as a map to the enduring source of truth. Maintain focused Markdown documents such as:

- `docs/PRODUCT.md` — users, problems, desired outcomes, scope, golden scenarios.
- `docs/ARCHITECTURE.md` — chosen stack, modules, data boundaries, agent/tool pattern, tradeoffs.
- `docs/DATA_MODEL.md` — entities, event semantics, provenance, permissions, migrations.
- `docs/INGESTION.md` — import/sync/indexing pipeline, freshness and recovery.
- `docs/AI_RELIABILITY.md` — retrieval, citation/claim validation, uncertainty, evaluation cases.
- `docs/WORKFLOWS.md` — roles, approvals, handoffs, action states.
- `docs/IMPLEMENTATION.md` — milestones, what is complete, test evidence, known gaps.
- `docs/PRIVACY_SECURITY.md` — source authorization, data handling, permissions, incident response, threat model and vendor processing.
- `docs/AI_PROVIDER_EVALUATION.md` — model and classifier choices, benchmark results, costs, privacy/retention conditions, fallbacks and dates verified.

Use task-specific `SKILL.md` reference/playbooks when they improve consistency: incident intake, evidence verification, policy lookup, and report generation. Load relevant instructions progressively rather than carrying every document in every prompt. Claude Code development instructions and production application knowledge should be conceptually separate. Markdown can encode procedures and project context; the authoritative live building records, permissions, and workflow state belong in the application's database/document store.

## 10. Technology decisions

Use **TypeScript end-to-end**. Choose a contemporary full-stack React approach (e.g., Next.js), strong accessible UI components, typed schema validation, durable persistence, authentication, file storage, and a reliable job/background-processing mechanism. Evaluate **Convex versus PostgreSQL/Supabase** specifically for relational/audit requirements, incremental indexing, permission boundaries, background jobs, development speed, portability, and cost. Make and document a clear selection; avoid requiring a particular database simply because it appeared in a prior draft.

**Suggested starting architecture to investigate rather than blindly adopt:** Next.js + TypeScript + a relational/auditable core (PostgreSQL/Supabase is a natural candidate); durable private object storage; SQL/full-text search with optional pgvector; transactional outbox / job queue with retry and scheduling (e.g. Supabase Queues/pgmq and Cron, or an appropriate workflow engine); Zod-validated tool/service boundaries; an adapter for one runtime model; and source-backed PDF output. **Convex is a credible alternative** because it has reactive data, full-text and vector indexes, and scheduled/durable workflows. Select it if its actual permission, audit, search and portability tradeoffs make it a better fit for this product. Record one concise architecture-decision document comparing at least these two candidates.

The first version can be a modular monolith, with a structured operational store, searchable source store, document storage, job processing, and model/tool adapter layer. Choose straightforward technology that supports accurate results and a clean future integration path. Consider a shared managed multi-tenant deployment first, and document a future enterprise option for a dedicated database or customer-selected cloud region/instance when warranted. A customer-controlled cloud deployment is a possible future contractual offering, not something the prototype must pretend it already supports. Separate how **Claude Code builds the product** from which **AI model powers the deployed product**. Treat PostHog as an optional, privacy-safe analytics adapter, not a requirement for the core product. It tracks feature usage and errors when permitted; it does not supply building memory or the case intelligence engine. Evaluate providers and current APIs before writing integration code; use secrets only server-side and provide `.env.example`. Ask before incurring charges or configuring irreversible external actions. Runtime API keys belong in local environment variables or a secret manager, never in an AI chat prompt, committed `.env` file, browser bundle, application log, or Markdown documentation. Create `.env.example` with placeholders and identify which services require credentials. The user can add Jev/OpenAI/Anthropic/Gemini keys locally through `.env.local` or deployment secret settings when ready; the development agent may verify a configured provider with harmless synthetic test inputs.

## 11. Product UX and design

Build an elegant, fast, approachable operations console with an immediately prominent **Ask Your Building** interaction. Design for front-desk laptops, managers' desktops, and tablets. Useful areas include Ask, Cases, Activity/Shift Log, Work Orders, Approvals, Policies, Staff/Handoffs, Reports, and Settings.

Emphasize legible timelines, employee/shift attribution, concise summaries, source inspection side panels, precise search/filtering, unresolved tasks, action confirmation screens, and polished PDF previews. Use a restrained B2B design system, accessible contrast and keyboard controls, informative empty/loading/error states, and subtle motion that clarifies related records. Build real interactive behavior rather than disconnected decorative views.

## 12. Synthetic data and independent evaluations

Create one credible fictional 84-unit building, **Riverside House**, with 25+ residents, 8+ employees including temp concierges, configurable shift schedules, 80+ shift notes, 35+ emails, 25+ work orders, 12+ policies, 12+ approvals, 12+ cases, media/document stubs and unrelated daily activity. Use realistic typos, duplicate reports, vague descriptions, late entries, conflicting statements, vacations, and incomplete follow-ups. Use fixed IDs and repeatable seed scripts.

Evaluate against an **independent source-of-truth answer key**, not merely the AI's own summary. Include clear cases and adversarial cases. Test exact counts, dates, identities, source links, observed-versus-reported wording, incomplete ingestion, missing emails, policy version changes, duplicate imports, unauthorized records, and voice transcription ambiguity. Record query-to-answer latency, retrieval coverage, unsupported claim rate, and time spent to reconstruct a case. If a model is offline, show an honest demo-mode fallback without fabricating access or claims.

## 13. Security, integrity, and operational readiness

Implement authentication, server-enforced role permissions, property/organization isolation, authorized source retrieval, private file access, audit logs, secure secrets, and privacy-conscious observability. Authorized property admins should be able to inspect and correct source associations and record history. Guard against prompt injection in resident emails, shift notes, and uploaded files. Keep model outputs separate from decisions made by policy engines and humans. Use source provenance, document hashing where useful, and audit trails to support reliable internal records. Treat any real resident/employee data and external property-platform connections as requiring appropriate authorization, privacy policies, retention controls, and security review before deployment.

## 14. Privacy, customer data control, AI-provider governance, and compliance readiness

**Product commitment:** Each property-management organization (the software customer, not an individual resident) must have meaningful control over its organizational operational records, permitted users, integrations, retention, exports, and approved AI processing. Privacy and security are product behavior and architecture—not a claim on a marketing page. Implement and test these controls with synthetic data from the outset, and clearly identify additional contractual/legal reviews before any real resident or employee data is introduced.

### 14.1 Data roles, ownership, and the boundaries of control

Design the service so customer organizations remain in control of the business records they contribute, subject to applicable law and contracts. The product operator processes them only to deliver authorized functionality, using disclosed service providers. Keep customer records logically separated from Threadline's own operational metrics and internal administration. Contractual data ownership, controller/processor roles, confidentiality, permitted purposes, subprocessors, incident responsibilities, and customer exit rights will require review in a service agreement and data-processing agreement (DPA). Do not promise that customer data never leaves customer infrastructure if a chosen cloud, transcription, search, or LLM provider receives it.

Provide a property/organization **Data & Privacy** settings area with: inventory of connected sources and requested access scopes; controls to connect, pause, sync, or disconnect each source; accessible audit history; configured storage/data region where the platform allows it; AI provider/model allowlist; data-sharing disclosure; organizational retention rules; administrator-controlled data export; and administrator-governed record-lifecycle actions. Make the controls functional for the synthetic prototype where feasible and label later enterprise controls honestly.

### 14.2 Classification and data minimization

Classify records at ingestion by sensitivity and purpose. Example classes: public building policies; internal operations; resident personal information; employee personal information; confidential complaint/case material; highly sensitive attachments (e.g., identification, access credentials, accommodation-related material, financial records). Permit building admins to configure ingestion scope and exclude irrelevant or excessively sensitive material. Apply field-level minimization and redaction/pseudonymization before sending material to an external model when the task permits. Keep original source access under stricter controls than derived summaries. Retain relationships through internal IDs rather than gratuitously duplicating names, phone numbers, and email addresses across indexes and prompts.

Use JEV/TypeSafe, OpenAI Decisions, deterministic classifiers, or another suitable typed decision layer to propose categories, urgency, PII flags, and possible case links when justified by current capabilities and representative evaluations. Treat probabilistic output as *suggested classification*, not proven accuracy, privacy authority, or access permission. Low-confidence, high-sensitivity, or consequential matches go to a human review queue. Security policy and authorization remain deterministic.

### 14.3 Access boundaries from ingestion to final answer

Enforce organization/property membership and least-privilege roles on source records, search indexes, embeddings, retrieval, agent tools, cached results, attachments, reports, and exports. Recheck access at retrieval and before a tool action; AI prompts must never be the enforcement boundary. In a report or cross-unit search, retrieve only records the querying user is entitled to see. Include synthetic two-company/two-property tests proving a user cannot infer another tenant's records through direct search, semantic retrieval, timelines, logs, reports, file links, or conversational follow-ups. Secure sessions, role changes, administrative access, and reasonable authentication protections including MFA capability.

### 14.4 Approved operational recordkeeping, not employee monitoring

**The product does not monitor employee productivity, attendance, private communication, whereabouts, or performance.** Employee names, roles, recorded shifts, and operational actions are used only to establish the chain of custody of a complaint or request, who made an observation, who authorized an action, and where a handoff stands. This purpose limitation should be reflected in product design, permissions, analytics, and documentation.

Let authorized organizational administrators define the exact building-controlled inboxes, folders, spreadsheets, shift-note inputs, and event types Threadline may process. Limit scheduled syncs to those sources and preserve source permissions when practical. Show last successful sync, indexed coverage, and paused sources. Maintain ingest audit logs. Connecting a shared front-desk mailbox does not confer permission to ingest an employee's personal mailbox. Recording voice dictation initiated by staff is different from recording ambient conversations or intercepting calls. Evaluate recording/notice obligations if audio capture features are expanded.

For Google Workspace, use least-privilege OAuth scopes and evaluate restricted-scope verification/security-review requirements before public rollout. For Microsoft 365, use appropriately scoped Microsoft Graph permissions and confirm organizational consent/tenant controls. Imports can provide a complete MVP without broad mailbox authorization.

### 14.5 Organization-controlled retention, lawful record lifecycle, legal holds, backups, and exports

The organization's normal operational records are not erased merely because a resident disputes or dislikes an incident log. Authorized property-management administrators determine lifecycle policy and can export company records, subject to applicable privacy rights, lawful requests, contractual limits, court orders, litigation holds, and legally required preservation. Document a process to handle applicable statutory access, correction, or deletion rights when such rights exist, rather than promising that residents have unrestricted deletion rights or no rights under any law.

Implement configurable retention by organization and record class, explicit approval for administrator-initiated archival or disposal, exportable records and source manifests, and an audit trail of administrative changes. Handle records under legal hold so they remain preserved despite ordinary retention schedules. When deletion is lawfully authorized, plan propagation through ingested source copies, extracted text, embeddings, cached answers, saved summaries, generated reports, and backups as applicable. A disconnected source stops future syncing, but existing ingested records remain governed by retention and preservation rules.

Use encryption in transit and at rest, secure secret management, private attachment access, backup/recovery procedures, production audit logging, incident response, access reviews, and vendor risk assessment. Log important access, exports, lifecycle changes, and permission changes without exposing case content to analytics. Include an incident-response runbook and breach-notification decision process.

### 14.6 Model-provider portability and disclosures

Separate AI capabilities behind reasonable provider interfaces for classification, embeddings, synthesis/reasoning, transcription, and speech. Initially evaluate **OpenAI, Anthropic, Google Gemini, and where appropriate privately deployed open-weight models** for task-level factual accuracy, extraction quality, cited-answer reliability, multimodal capabilities, latency, cost, availability, retention, training use, region, contractual DPA, subprocessors, and endpoint-specific data handling. Avoid needless abstraction: make the provider swappable through one clean boundary while choosing one practical runtime default for the MVP.

Compare JEV and OpenAI Decisions for bounded decisions against a simple rules/LLM baseline. Evaluate text and image/document cases separately. Confirm Jev's current image/Box support and experimental constraints; confirm the OpenAI Decisions API's current input formats and model availability. The selected provider for classification may differ from the model selected for conversational reasoning. The application should function with a disabled or unavailable optional classifier.

An organizational administrator should be able to restrict approved providers by task and sensitivity class; a disallowed or unavailable provider must not trigger silent transfer to another. Do not assume 'API data not used for training' means 'zero retention'; inspect endpoint-, account-, and feature-specific behavior. Consider private deployment options where vendor processing constraints are too strict. DeepSeek-hosted service is outside the initial provider shortlist.

### 14.7 Legal and regulatory assessment (New York-first, extensible)

Record a compliance checklist and counsel-review gate before production use. For New York, evaluate the SHIELD Act's requirement for reasonable administrative, technical, and physical safeguards when covered private information is maintained, plus breach/notification obligations. Threadline's purpose is incident documentation, **not employee communication monitoring**; nevertheless have counsel assess any potentially applicable workplace notice requirements if the implementation materially changes. Assess recording/notice laws if voice capture or audio recordings are enabled in a deployment. For other deployments, identify applicable state consumer-privacy laws, data-transfer laws, employment rules, and contractual/property policies. NIST CSF 2.0 and OWASP guidance for LLM systems are practical security design references; they are not automatic certifications. Apply a privacy/security threat model to agent access, prompt injection in resident emails, sensitive information disclosure, false case associations, and excessive agency. Legal conclusions and automated adverse housing decisions require human review.

**Official reference starting points (re-check current versions):**
- NY Attorney General SHIELD Act: https://ag.ny.gov/resources/organizations/data-breach-reporting/shield-act
- New York State § 899-bb: https://www.nysenate.gov/legislation/laws/GBS/899-BB
- New York employee electronic monitoring § 52-c: https://www.nysenate.gov/legislation/laws/CVR/52-C%2A2
- Google Workspace API User Data Policy: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Google restricted-scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data
- Anthropic API data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- OpenAI Decisions API: https://developers.openai.com/api/docs/guides/decisions
- Official TypeSafe Jev skill and docs: https://github.com/typesafe-ai/skills and https://docs.typesafe.ai
- Microsoft Graph delta query guidance: https://learn.microsoft.com/en-us/graph/delta-query-overview
- Google Drive change feed: https://developers.google.com/workspace/drive/api/guides/manage-changes
- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework
- OWASP LLM guidance: https://owasp.org/projects/top-10-for-large-language-model-applications

### 14.8 Required deliverables and verification

Create `docs/PRIVACY_SECURITY.md` (data inventory, threat model, processing flow, provider risk matrix, roles/permissions, retention/deletion/export behavior, regulatory checklist, launch gate), plus a concise sample `docs/DPA_REQUIREMENTS.md` describing contract topics for qualified legal review. Add a Data & Privacy admin area, a configurable provider adapter/allowlist, a sensitivity-aware ingest path, tenant-isolation tests, an organizational export and authorized-retention workflow proof of concept, provider-request logging that excludes content, and a clear deployment readiness checklist. Keep all demonstrations synthetic until contracts, access permissions, operational controls, and applicable legal review have been completed.


## 15. Build sequence and definition of done

Start by inspecting the repository, researching current official documentation for key dependencies, and producing a short build plan with the chosen architecture. Then **implement rather than stopping at planning**.

Work in vertical slices:

1. App shell, identities/roles, schema, source records, event ledger, seeded property.
2. Ingestion and indexing of synthetic shift logs and emails; search and retrieval.
3. The full smoke-complaint investigation: question → connected events → verified answer → inspect sources → evidence gaps → PDF packet.
4. Approval/work-order workflow for the key request and policy-review workflow for the mirror request.
5. Staff/shift handoffs, noise-complaint/media case, new-manager briefing, and voice interaction.
   - Include a visible **Data & Privacy** settings view and source-scoping/retention model using the synthetic property.
6. Integration adapters and mock/source-authorized connectors, reliability tests, cross-organization privacy/permission tests, organizational export/retention demonstration, and polished UX.

Keep the architecture extensible, but prioritize **the first complete working scenario** over broad superficial coverage. Use project Markdown documents as a navigable, persistent engineering memory; revise them when architectural choices change. Verify functionality with TypeScript checks, linting, unit/integration tests, browser end-to-end tests, actual app inspection, and testable PDF output.

**Acceptance experience:** A manager opens Threadline, asks about Unit 12B's smoke complaints, receives a truthful and source-linked timeline with staff shifts and investigation outcomes, inspects original entries, sees clearly identified evidence gaps, asks follow-up questions by voice or text, and exports a referenced packet. The same app then supports a key request through approval and maintenance status, a policy-based mirror request, a temp-staff handoff, and a new-manager briefing. All workflows persist as real records and are constrained by staff permissions.

**Deliver:** runnable TypeScript codebase, migrations/schema, realistic seed/import scripts, working agent and retrieval tools, functional workflows and reports, accessible interface, `.env.example`, setup instructions, `CLAUDE.md`/project documentation, `docs/PRIVACY_SECURITY.md`, privacy test results, and a candid distinction between implemented features, demo-mode integrations, and deferred production requirements.

Make the core operational experience exceptional. The desired result is not that a manager believes the software is intelligent; it is that the manager can **obtain the documented history, verify each important fact, and act confidently in substantially less time.**


## 16. Claude Code handoff and engineering discretion

This brief describes the user's problem, product promise, users, example cases, data trust standards, interactions, and expected deliverables. It does **not** dictate every package or implementation pattern. Use informed engineering judgment; when you find a better technical approach, revise the architecture and explain the tradeoff briefly in `docs/ARCHITECTURE.md` rather than discarding a core product requirement.

**Before implementation:** Inspect the repository and actual development environment. Compare a couple of practical backend choices (including Supabase/PostgreSQL and Convex), choose a reasonable default, and document the tradeoffs of audit integrity, permissions, searchable source content, background ingestion, export/retention, costs, and ease of shipping. Compare practical runtime model options on accuracy/privacy/cost. Put secrets in `.env.local` or a secret manager and provide `.env.example`; user-supplied runtime keys must not enter chat transcripts, markdown files, or committed source code. Ask for permission only when access credentials, paid services, real-world actions, destructive migrations, or privacy-sensitive integrations require it.

**Developer harness:** Create a short root `CLAUDE.md` mapping the important architecture documents, the development commands, testing requirements, and the evidence/permission invariants. Keep long references in focused Markdown docs or useful Claude Code skills. Use subagents sparingly for bounded parallel work or independent evaluation, not by default. Separate development-time Claude Code memory from the application's own document/event store and AI conversational state.

**Build sequence:** Start with a convincing functional smoke-complaint vertical slice using realistic synthetic mixed-format records, then complete key approval/work order and policy/mirror flows, shift handoffs/new-manager briefings, multimodal/voice exploration, and organization admin controls. Ingestion and source verification must be functional within the initial vertical slice. Prefer complete interactive paths to feature checklists. Verify permissions, retrieval accuracy, PDF citations, indexing freshness, and action auditability with actual automated tests and browser runs.

**Benchmarking and claims:** Track exact fact extraction, citation support, cross-property isolation, case-linking precision, unsupported-claim rate, missing-record handling, indexing latency, end-to-end query time, and cost per case. A synthetic demo should showcase what truly works and distinguish simulation from external integrations. No claims of guaranteed legal outcomes or perfect hallucination elimination. Make the application tell the user when evidence is missing or a source has not finished syncing.

**Final handoff:** Provide instructions to start the app, seed the fake building, run a canonical query, test a pending approval and work order, speak a query if voice is configured, export a referenced PDF, and view the organization Data & Privacy controls. Record how to supply each required runtime API key securely, exact commands/tests you ran, decisions made, limitations, and suggested next milestone. Continue implementation after planning; ensure the project is runnable and core behavior has been exercised.

**North star:** A manager can ask the building what happened, inspect original documentation, understand who handled each operational step without monitoring staff, see what remains uncertain, and act on an authorized next step from one dependable workspace.
