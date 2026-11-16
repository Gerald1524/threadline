CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"case_id" text,
	"unit_id" text,
	"resident_id" text,
	"policy_version_id" text,
	"needed_by" timestamp with time zone,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text,
	"seq" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"sensitivity" text DEFAULT 'internal_ops' NOT NULL,
	"source_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"case_id" text NOT NULL,
	"event_id" text NOT NULL,
	"link_status" text NOT NULL,
	"method" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"rationale" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"unit_id" text,
	"complainant_unit_id" text,
	"complainant_resident_id" text,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" text DEFAULT 'system:ingest' NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"event_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"ord" integer NOT NULL,
	"classification" text NOT NULL,
	"outcome" text,
	"text" text NOT NULL,
	"observer_user_id" text
);
--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"input_mode" text DEFAULT 'text' NOT NULL,
	"answer" jsonb NOT NULL,
	"mode" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"user_id" text NOT NULL,
	"focus" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'import' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"default_visibility" text DEFAULT 'staff' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"coverage_from" timestamp with time zone,
	"coverage_through" timestamp with time zone,
	"coverage_note" text,
	"sync_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"type" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"channel" text DEFAULT 'document' NOT NULL,
	"direction" text DEFAULT 'internal' NOT NULL,
	"summary" text NOT NULL,
	"unit_id" text,
	"reporter_unit_id" text,
	"reporter_resident_id" text,
	"reporter_name" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"late_entry" boolean DEFAULT false NOT NULL,
	"recorder_user_id" text,
	"on_duty_user_id" text,
	"on_duty_assignment_id" text,
	"investigator_user_id" text,
	"assignee_user_id" text,
	"approver_user_id" text,
	"thread_key" text,
	"external_ref" text,
	"in_reply_to_ref" text,
	"work_order_id" text,
	"policy_version_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"duplicate_of_event_id" text,
	"corrects_event_id" text,
	"extraction_method" text DEFAULT 'rules' NOT NULL,
	"extraction_confidence" real DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"sensitivity" text DEFAULT 'internal_ops' NOT NULL,
	"has_attachment" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manifest" jsonb NOT NULL,
	"blob_id" text,
	"sha256" text
);
--> statement-breakpoint
CREATE TABLE "handoff_acks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"handoff_id" text NOT NULL,
	"user_id" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"shift_label" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"source_id" text NOT NULL,
	"filename" text NOT NULL,
	"blob_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"idempotency_key" text NOT NULL,
	"result" jsonb,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"case_id" text NOT NULL,
	"reason" text NOT NULL,
	"placed_by" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" text,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lifecycle_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action" text NOT NULL,
	"record_class" text NOT NULL,
	"older_than" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"held_count" integer DEFAULT 0 NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"property_id" text,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"to_label" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"case_id" text,
	"work_order_id" text,
	"drafted_by" text NOT NULL,
	"draft_origin" text DEFAULT 'template' NOT NULL,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"delivery_mode" text DEFAULT 'simulated' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"data_region" text DEFAULT 'us-east (demo: local disk)' NOT NULL,
	"retention" jsonb NOT NULL,
	"provider_policy" jsonb NOT NULL,
	"excluded_sensitivity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"effective_from" text,
	"approved_by_name" text,
	"body" text NOT NULL,
	"source_record_id" text
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"task" text NOT NULL,
	"model" text,
	"max_sensitivity" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"error_code" text,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"case_id" text NOT NULL,
	"title" text NOT NULL,
	"generated_by" text NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source_count" integer NOT NULL,
	"pdf_blob_id" text,
	"pdf_sha256" text
);
--> statement-breakpoint
CREATE TABLE "residencies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"resident_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"source_record_id" text,
	"event_id" text,
	"related_event_id" text,
	"case_id" text,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"shift_definition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"coverage_type" text DEFAULT 'scheduled' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "shift_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"name" text NOT NULL,
	"role_scope" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"source_id" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"locator" text NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filename" text,
	"author" text,
	"content_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"occurred_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sensitivity" text DEFAULT 'internal_ops' NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"injection_flag" boolean DEFAULT false NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"label" text NOT NULL,
	"floor" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"job_title" text NOT NULL,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"unit_id" text,
	"case_id" text,
	"approval_id" text,
	"assignee_user_id" text,
	"eta" timestamp with time zone,
	"resolution_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"source_record_id" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_idem" ON "approvals" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_org_seq" ON "audit_log" USING btree ("org_id","seq");--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_events_pair" ON "case_events" USING btree ("case_id","event_id");--> statement-breakpoint
CREATE INDEX "claims_event" ON "claims" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_property_time" ON "events" USING btree ("property_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_unit" ON "events" USING btree ("property_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_acks_pair" ON "handoff_acks" USING btree ("handoff_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_jobs_idem" ON "ingest_jobs" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idem" ON "messages" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_key" ON "policies" USING btree ("property_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_pair" ON "policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "shift_assign_window" ON "shift_assignments" USING btree ("property_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_identity" ON "source_records" USING btree ("org_id","source_id","external_id","version");--> statement-breakpoint
CREATE INDEX "source_records_property" ON "source_records" USING btree ("property_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "units_property_label" ON "units" USING btree ("property_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_idem" ON "work_orders" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_number" ON "work_orders" USING btree ("property_id","number");