-- The plain role for the database guard (CONTRACTS section 12, rule 13).
--
-- The app signs in as the role that owns the pulse tables, and an owner skips row level
-- security. With PULSE_DB_GUARD=1 the app opens every statement with
--
--   SET LOCAL ROLE pulse_app; SELECT set_config('pulse.org_id', '<org uuid>', true)
--
-- pulse_app owns nothing, cannot sign in, is not a superuser and cannot skip row level security,
-- so the policies of 0007 apply to everything the app runs for one workspace.
--
-- What this file does:
--   1. Makes the role pulse_app if it is not there.
--   2. Lets the role that runs this migration become pulse_app (SET ROLE needs membership).
--   3. Grants pulse_app what the app needs in schema pulse: read and write on tables, use of
--      sequences, run of functions. Tables made later by the same owner get the same grants.
--   4. Lets pulse_app read three core tables the Pulse queries join to (organization, member,
--      user), each behind a policy for pulse_app only: the row must belong to the workspace in
--      pulse.org_id. No other role is touched, and nothing in core changes for the other apps.
--
-- Nothing changes for the running app until PULSE_DB_GUARD=1 is set.
--
-- Every step is safe to run again. A step the migration role is not allowed to do (for example
-- CREATE ROLE on a host where it has no CREATEROLE right) is skipped with a NOTICE and the
-- migration still succeeds. /api/health then answers guard ready: false, and the steps in
-- CONTRACTS section 12, rule 13 say what to run by hand. Do not turn the flag on until ready is true.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    CREATE ROLE pulse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pulse 0009: skipped CREATE ROLE pulse_app (not allowed for %). Ask a database admin to make it.', current_user;
  WHEN duplicate_object THEN
    NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app')
     AND NOT pg_has_role(current_user, 'pulse_app', 'MEMBER') THEN
    EXECUTE format('GRANT pulse_app TO %I', current_user);
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pulse 0009: skipped GRANT pulse_app TO % (not allowed).', current_user;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    RAISE NOTICE 'pulse 0009: role pulse_app is missing, grants skipped.';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA pulse TO pulse_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pulse TO pulse_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pulse TO pulse_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pulse TO pulse_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA pulse GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pulse_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA pulse GRANT USAGE, SELECT ON SEQUENCES TO pulse_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA pulse GRANT EXECUTE ON FUNCTIONS TO pulse_app;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pulse 0009: skipped the grants on schema pulse (not allowed for %).', current_user;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  org_setting constant text := '(SELECT NULLIF(current_setting(''pulse.org_id'', true), '''')::uuid)';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    RAISE NOTICE 'pulse 0009: role pulse_app is missing, core grants skipped.';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA core TO pulse_app;
  GRANT SELECT ON core.organization, core.member, core."user" TO pulse_app;

  DROP POLICY IF EXISTS "pulse_app_read_own_org" ON core.organization;
  EXECUTE 'CREATE POLICY "pulse_app_read_own_org" ON core.organization AS PERMISSIVE FOR SELECT TO pulse_app USING ("id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "pulse_app_read_own_org" ON core.member;
  EXECUTE 'CREATE POLICY "pulse_app_read_own_org" ON core.member AS PERMISSIVE FOR SELECT TO pulse_app USING ("organization_id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "pulse_app_read_own_org" ON core."user";
  EXECUTE 'CREATE POLICY "pulse_app_read_own_org" ON core."user" AS PERMISSIVE FOR SELECT TO pulse_app USING ("id" IN (SELECT m."user_id" FROM core.member m WHERE m."organization_id" = ' || org_setting || '))';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pulse 0009: skipped the read grants on core (not allowed for %).', current_user;
END $$;
