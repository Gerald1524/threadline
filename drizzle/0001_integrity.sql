-- Integrity and search objects that are not expressible in the Drizzle schema.

-- 1. Audit log is append-only.
CREATE OR REPLACE FUNCTION threadline_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'threadline: % on % is not permitted (append-only)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION threadline_block_mutation();
--> statement-breakpoint

-- 2. Preserved originals are immutable. A changed upstream record must be stored as a new
--    version. The only permitted content change is an authorized disposal, which tombstones
--    the row (lifecycle = 'disposed') while keeping its identity and hash for the audit trail.
CREATE OR REPLACE FUNCTION threadline_protect_source() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'threadline: source records cannot be deleted; use an approved disposal';
  END IF;
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'threadline: content_hash of a source record is immutable';
  END IF;
  IF (NEW.raw_text IS DISTINCT FROM OLD.raw_text OR NEW.raw_json IS DISTINCT FROM OLD.raw_json)
     AND NEW.lifecycle <> 'disposed' THEN
    RAISE EXCEPTION 'threadline: original source content is immutable; ingest a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER source_records_protect BEFORE UPDATE OR DELETE ON source_records
  FOR EACH ROW EXECUTE FUNCTION threadline_protect_source();
--> statement-breakpoint

-- 3. Full-text search over preserved originals.
ALTER TABLE source_records ADD COLUMN search tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(raw_text, ''))) STORED;
--> statement-breakpoint
CREATE INDEX source_records_search ON source_records USING GIN (search);
