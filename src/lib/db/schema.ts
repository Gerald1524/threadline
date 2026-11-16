/**
 * Threadline data model.
 *
 * Layers (see docs/DATA_MODEL.md):
 *   raw sources      -> source_records, blobs            (immutable originals, hashed)
 *   derived evidence -> events, claims, case_events      (re-derivable, version-audited)
 *   operations       -> cases, work_orders, approvals, messages, handoffs
 *   governance       -> audit_log, org_settings, legal_holds, lifecycle_requests, exports
 *
 * Every tenant-owned row carries org_id and (where applicable) property_id so the
 * access layer can scope every query without joins.
 */
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const tenant = {
  orgId: text("org_id").notNull(),
  propertyId: text("property_id").notNull(),
};

// ---------------------------------------------------------------- tenancy & people

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const properties = pgTable("properties", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  unitCount: integer("unit_count").notNull().default(0),
});

export const units = pgTable(
  "units",
  { id: text("id").primaryKey(), ...tenant, label: text("label").notNull(), floor: integer("floor").notNull() },
  (t) => [uniqueIndex("units_property_label").on(t.propertyId, t.label)],
);

export const residents = pgTable("residents", {
  id: text("id").primaryKey(),
  ...tenant,
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
});

/** Occupancy is dated so "12B" can be resolved to the occupant at the time of an event. */
export const residencies = pgTable("residencies", {
  id: text("id").primaryKey(),
  ...tenant,
  residentId: text("resident_id").notNull(),
  unitId: text("unit_id").notNull(),
  startDate: text("start_date").notNull(), // ISO date
  endDate: text("end_date"),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  jobTitle: text("job_title").notNull(),
  employmentType: text("employment_type").notNull().default("permanent"), // permanent | temp | contractor
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

/** propertyId null = organization-wide membership (regional admin). */
export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id").notNull(),
  propertyId: text("property_id"),
  role: text("role").notNull(),
});

export const shiftDefinitions = pgTable("shift_definitions", {
  id: text("id").primaryKey(),
  ...tenant,
  name: text("name").notNull(),
  roleScope: text("role_scope").notNull(), // front_desk | porter | maintenance
  startTime: text("start_time").notNull(), // "07:00" local
  endTime: text("end_time").notNull(),
});

/**
 * Actual coverage, stored as absolute instants. Exists only to attribute an operational
 * event to the staff member on duty; it is not a time-and-attendance record.
 */
export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: text("id").primaryKey(),
    ...tenant,
    shiftDefinitionId: text("shift_definition_id").notNull(),
    userId: text("user_id").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    coverageType: text("coverage_type").notNull().default("scheduled"), // scheduled | temp_cover | overtime
    note: text("note"),
  },
  (t) => [index("shift_assign_window").on(t.propertyId, t.startsAt, t.endsAt)],
);

// ---------------------------------------------------------------- sources & ingestion

export const dataSources = pgTable("data_sources", {
  id: text("id").primaryKey(),
  ...tenant,
  kind: text("kind").notNull(), // manual | csv | xlsx | docs_export | eml | pdf | m365 | google_workspace | property_platform
  name: text("name").notNull(),
  mode: text("mode").notNull().default("import"), // import | in_app | mock_connector | planned_connector
  status: text("status").notNull().default("active"), // active | paused | disconnected | planned
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  description: text("description"),
  defaultVisibility: text("default_visibility").notNull().default("staff"),
  lastSyncAt: ts("last_sync_at"),
  lastSuccessAt: ts("last_success_at"),
  lastError: text("last_error"),
  coverageFrom: ts("coverage_from"),
  coverageThrough: ts("coverage_through"),
  coverageNote: text("coverage_note"),
  syncCursor: text("sync_cursor"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: text("id").primaryKey(),
    ...tenant,
    sourceId: text("source_id").notNull(),
    filename: text("filename").notNull(),
    blobId: text("blob_id"),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull(),
    result: jsonb("result").$type<Record<string, number>>(),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [uniqueIndex("ingest_jobs_idem").on(t.orgId, t.idempotencyKey)],
);

/** Private object storage index. Bytes live in the blob store adapter (local disk in dev). */
export const blobs = pgTable("blobs", {
  id: text("id").primaryKey(),
  ...tenant,
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  sensitivity: text("sensitivity").notNull().default("internal_ops"),
  sourceRecordId: text("source_record_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * The preserved original. raw_text / raw_json / content_hash are immutable (enforced by a
 * database trigger); a changed upstream record becomes a new version that supersedes this one.
 */
export const sourceRecords = pgTable(
  "source_records",
  {
    id: text("id").primaryKey(),
    ...tenant,
    sourceId: text("source_id").notNull(),
    kind: text("kind").notNull(), // shift_note | email | work_order | policy_doc | document | manual_entry | voice_dictation
    externalId: text("external_id").notNull(),
    locator: text("locator").notNull(),
    title: text("title").notNull(),
    rawText: text("raw_text").notNull(),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>().notNull().default({}),
    filename: text("filename"),
    author: text("author"),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),
    supersedesId: text("supersedes_id"),
    isCurrent: boolean("is_current").notNull().default(true),
    occurredAt: ts("occurred_at"),
    recordedAt: ts("recorded_at"),
    receivedAt: ts("received_at"),
    ingestedAt: ts("ingested_at").notNull().defaultNow(),
    sensitivity: text("sensitivity").notNull().default("internal_ops"),
    visibility: text("visibility").notNull().default("staff"), // staff | management | restricted
    injectionFlag: boolean("injection_flag").notNull().default(false),
    lifecycle: text("lifecycle").notNull().default("active"), // active | archived | disposed
    jobId: text("job_id"),
  },
  (t) => [
    uniqueIndex("source_records_identity").on(t.orgId, t.sourceId, t.externalId, t.version),
    index("source_records_property").on(t.propertyId, t.kind),
  ],
);

// ---------------------------------------------------------------- derived evidence

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    ...tenant,
    sourceRecordId: text("source_record_id").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull().default("general"),
    channel: text("channel").notNull().default("document"),
    direction: text("direction").notNull().default("internal"), // inbound | outbound | internal
    summary: text("summary").notNull(),
    unitId: text("unit_id"), // unit the matter concerns
    reporterUnitId: text("reporter_unit_id"),
    reporterResidentId: text("reporter_resident_id"),
    reporterName: text("reporter_name"),
    occurredAt: ts("occurred_at").notNull(),
    recordedAt: ts("recorded_at"),
    receivedAt: ts("received_at"),
    ingestedAt: ts("ingested_at").notNull().defaultNow(),
    timezone: text("timezone").notNull().default("America/New_York"),
    lateEntry: boolean("late_entry").notNull().default(false),
    recorderUserId: text("recorder_user_id"),
    onDutyUserId: text("on_duty_user_id"),
    onDutyAssignmentId: text("on_duty_assignment_id"),
    investigatorUserId: text("investigator_user_id"),
    assigneeUserId: text("assignee_user_id"),
    approverUserId: text("approver_user_id"),
    threadKey: text("thread_key"),
    externalRef: text("external_ref"), // e.g. RFC822 Message-ID
    inReplyToRef: text("in_reply_to_ref"),
    workOrderId: text("work_order_id"),
    policyVersionId: text("policy_version_id"),
    status: text("status").notNull().default("active"), // active | duplicate | superseded | retracted
    duplicateOfEventId: text("duplicate_of_event_id"),
    correctsEventId: text("corrects_event_id"),
    extractionMethod: text("extraction_method").notNull().default("rules"), // rules | model | human | structured
    extractionConfidence: real("extraction_confidence").notNull().default(1),
    visibility: text("visibility").notNull().default("staff"),
    sensitivity: text("sensitivity").notNull().default("internal_ops"),
    hasAttachment: boolean("has_attachment").notNull().default(false),
  },
  (t) => [index("events_property_time").on(t.propertyId, t.occurredAt), index("events_unit").on(t.propertyId, t.unitId)],
);

/**
 * Sentence-level assertions quoted from the source, each classified by who is asserting what.
 * This is what keeps "the resident said" separate from "staff observed".
 */
export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    ...tenant,
    eventId: text("event_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    ord: integer("ord").notNull(),
    classification: text("classification").notNull(), // allegation | staff_observation | documented_action | statement | note
    outcome: text("outcome"), // no_odor_detected | odor_common_area | no_answer | denial | contact_made | no_noise_detected | ...
    text: text("text").notNull(),
    observerUserId: text("observer_user_id"),
  },
  (t) => [index("claims_event").on(t.eventId)],
);

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  ...tenant,
  number: text("number").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("open"), // open | investigating | awaiting_response | resolved | closed
  unitId: text("unit_id"),
  complainantUnitId: text("complainant_unit_id"),
  complainantResidentId: text("complainant_resident_id"),
  openedAt: ts("opened_at").notNull(),
  closedAt: ts("closed_at"),
  createdBy: text("created_by").notNull().default("system:ingest"),
  visibility: text("visibility").notNull().default("staff"),
});

export const caseEvents = pgTable(
  "case_events",
  {
    id: text("id").primaryKey(),
    ...tenant,
    caseId: text("case_id").notNull(),
    eventId: text("event_id").notNull(),
    linkStatus: text("link_status").notNull(), // confirmed | suggested | rejected
    method: text("method").notNull(), // rule | thread | model | human
    confidence: real("confidence").notNull().default(1),
    rationale: text("rationale").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
  },
  (t) => [uniqueIndex("case_events_pair").on(t.caseId, t.eventId)],
);

export const reviewItems = pgTable("review_items", {
  id: text("id").primaryKey(),
  ...tenant,
  type: text("type").notNull(), // tentative_link | duplicate_candidate | ambiguous_identity | low_confidence | sensitive_content | suspected_injection
  status: text("status").notNull().default("open"), // open | resolved | dismissed
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  sourceRecordId: text("source_record_id"),
  eventId: text("event_id"),
  relatedEventId: text("related_event_id"),
  caseId: text("case_id"),
  resolution: text("resolution"),
  resolvedBy: text("resolved_by"),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- operations

export const workOrders = pgTable(
  "work_orders",
  {
    id: text("id").primaryKey(),
    ...tenant,
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"), // open | assigned | in_progress | on_hold | completed | cancelled
    priority: text("priority").notNull().default("normal"),
    unitId: text("unit_id"),
    caseId: text("case_id"),
    approvalId: text("approval_id"),
    assigneeUserId: text("assignee_user_id"),
    eta: ts("eta"),
    resolutionNote: text("resolution_note"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    completedAt: ts("completed_at"),
    sourceRecordId: text("source_record_id"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [uniqueIndex("work_orders_idem").on(t.orgId, t.idempotencyKey), uniqueIndex("work_orders_number").on(t.propertyId, t.number)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    ...tenant,
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | denied | withdrawn
    caseId: text("case_id"),
    unitId: text("unit_id"),
    residentId: text("resident_id"),
    policyVersionId: text("policy_version_id"),
    neededBy: ts("needed_by"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: ts("requested_at").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [uniqueIndex("approvals_idem").on(t.orgId, t.idempotencyKey)],
);

export const policies = pgTable(
  "policies",
  { id: text("id").primaryKey(), ...tenant, key: text("key").notNull(), title: text("title").notNull(), category: text("category").notNull() },
  (t) => [uniqueIndex("policies_key").on(t.propertyId, t.key)],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: text("id").primaryKey(),
    ...tenant,
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(), // draft | approved | superseded
    effectiveFrom: text("effective_from"),
    approvedByName: text("approved_by_name"),
    body: text("body").notNull(),
    sourceRecordId: text("source_record_id"),
  },
  (t) => [uniqueIndex("policy_versions_pair").on(t.policyId, t.version)],
);

/** Outbound communications are drafted, reviewed by a human, then "sent" (simulated delivery, logged). */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    ...tenant,
    kind: text("kind").notNull(), // maintenance_update_request | resident_update | internal_note
    audience: text("audience").notNull(), // maintenance | resident | management
    toLabel: text("to_label").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("draft"), // draft | sent | discarded
    caseId: text("case_id"),
    workOrderId: text("work_order_id"),
    draftedBy: text("drafted_by").notNull(),
    draftOrigin: text("draft_origin").notNull().default("template"), // template | model | human
    sentBy: text("sent_by"),
    sentAt: ts("sent_at"),
    deliveryMode: text("delivery_mode").notNull().default("simulated"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("messages_idem").on(t.orgId, t.idempotencyKey)],
);

export type HandoffItem = { kind: "case" | "work_order" | "approval" | "note"; refId?: string; text: string };

export const handoffs = pgTable("handoffs", {
  id: text("id").primaryKey(),
  ...tenant,
  fromUserId: text("from_user_id").notNull(),
  shiftLabel: text("shift_label").notNull(),
  note: text("note").notNull().default(""),
  items: jsonb("items").$type<HandoffItem[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const handoffAcks = pgTable(
  "handoff_acks",
  {
    id: text("id").primaryKey(),
    ...tenant,
    handoffId: text("handoff_id").notNull(),
    userId: text("user_id").notNull(),
    acknowledgedAt: ts("acknowledged_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("handoff_acks_pair").on(t.handoffId, t.userId)],
);

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  ...tenant,
  caseId: text("case_id").notNull(),
  title: text("title").notNull(),
  generatedBy: text("generated_by").notNull(),
  reviewNote: text("review_note").notNull().default(""),
  generatedAt: ts("generated_at").notNull().defaultNow(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  sourceCount: integer("source_count").notNull(),
  pdfBlobId: text("pdf_blob_id"),
  pdfSha256: text("pdf_sha256"),
});

// ---------------------------------------------------------------- conversations (AI state, separate from records)

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  ...tenant,
  userId: text("user_id").notNull(),
  focus: jsonb("focus").$type<{ caseId?: string; unitId?: string; dateIso?: string; workOrderId?: string; policyKey?: string }>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const conversationTurns = pgTable("conversation_turns", {
  id: text("id").primaryKey(),
  ...tenant,
  conversationId: text("conversation_id").notNull(),
  userId: text("user_id").notNull(),
  question: text("question").notNull(),
  inputMode: text("input_mode").notNull().default("text"), // text | voice
  answer: jsonb("answer").$type<Record<string, unknown>>().notNull(),
  mode: text("mode").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- governance

/** Append-only (trigger-enforced) and hash-chained per organization. Never holds record content. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    propertyId: text("property_id"),
    seq: integer("seq").notNull(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: text("actor_user_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [uniqueIndex("audit_org_seq").on(t.orgId, t.seq), index("audit_entity").on(t.entityType, t.entityId)],
);

export type ProviderPolicy = Record<string, { provider: string; allowedSensitivity: string[] }>;
export type RetentionPolicy = Record<string, { days: number | null }>;

export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id").primaryKey(),
  dataRegion: text("data_region").notNull().default("us-east (demo: local disk)"),
  retention: jsonb("retention").$type<RetentionPolicy>().notNull(),
  providerPolicy: jsonb("provider_policy").$type<ProviderPolicy>().notNull(),
  excludedSensitivity: jsonb("excluded_sensitivity").$type<string[]>().notNull().default([]),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

/** Metadata-only log of calls to external AI providers. No prompts, no outputs. */
export const providerRequests = pgTable("provider_requests", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  at: ts("at").notNull().defaultNow(),
  provider: text("provider").notNull(),
  task: text("task").notNull(),
  model: text("model"),
  maxSensitivity: text("max_sensitivity").notNull(),
  status: text("status").notNull(), // ok | error | blocked_by_policy | not_configured
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  userId: text("user_id"),
});

export const legalHolds = pgTable("legal_holds", {
  id: text("id").primaryKey(),
  ...tenant,
  caseId: text("case_id").notNull(),
  reason: text("reason").notNull(),
  placedBy: text("placed_by").notNull(),
  placedAt: ts("placed_at").notNull().defaultNow(),
  releasedBy: text("released_by"),
  releasedAt: ts("released_at"),
});

export const lifecycleRequests = pgTable("lifecycle_requests", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  action: text("action").notNull(), // archive | dispose
  recordClass: text("record_class").notNull(),
  olderThan: ts("older_than").notNull(),
  status: text("status").notNull().default("proposed"), // proposed | executed | rejected
  matchedCount: integer("matched_count").notNull().default(0),
  heldCount: integer("held_count").notNull().default(0),
  affectedCount: integer("affected_count").notNull().default(0),
  requestedBy: text("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
});

export const exportsTable = pgTable("exports", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  blobId: text("blob_id"),
  sha256: text("sha256"),
});
