-- Row-level security: organization isolation enforced by the database itself.
--
-- The application signs in as the user that owns these tables (and runs migrations). For
-- every piece of work done on behalf of a signed-in person it switches the connection to
-- the unprivileged role threadline_app and sets app.org_id to that person's organization.
-- The policies below then confine every read and write to that organization's rows, so a
-- query that forgets its organization filter returns nothing from anyone else.
-- Work that is not on behalf of one organization (sign-in lookup, seeding, migrations, the
-- import worker's queue) runs as the owner, which row-level security does not restrict.
-- Property and role scoping inside an organization remain in src/lib/access.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'threadline_app') THEN
    BEGIN
      CREATE ROLE threadline_app NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'Threadline needs a database role named threadline_app, and % may not create roles. Ask a database administrator to run: CREATE ROLE threadline_app NOLOGIN; GRANT threadline_app TO %;', current_user, current_user;
    END;
  END IF;
  IF NOT pg_has_role(current_user, 'threadline_app', 'MEMBER') THEN
    EXECUTE format('GRANT threadline_app TO %I', current_user);
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO threadline_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO threadline_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO threadline_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO threadline_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO threadline_app;
--> statement-breakpoint

-- The audit log is append-only and originals are never deleted. The triggers in 0001 already
-- refuse these; the runtime role is not even granted them.
REVOKE UPDATE, DELETE ON audit_log FROM threadline_app;
--> statement-breakpoint
REVOKE DELETE ON source_records FROM threadline_app;
--> statement-breakpoint

-- One policy per table that carries org_id. tests/rls.test.ts fails if a table is added
-- without row-level security, so a new table cannot silently skip this.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (org_id = current_setting(''app.org_id'', true)) WITH CHECK (org_id = current_setting(''app.org_id'', true))',
      r.relname);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organizations USING (id = current_setting('app.org_id', true)) WITH CHECK (id = current_setting('app.org_id', true));
