-- Row level security policies for the pulse schema.
--
-- Before this file every pulse table had RLS turned on with no policy. The app connects as the
-- table owner, and an owner skips RLS, so the database itself never kept two workspaces apart.
-- Now every table has one policy for all commands (read, add, change, remove):
--
--   a row is allowed only when its org_id equals the session setting pulse.org_id.
--
-- A role with no setting sees nothing and can write nothing. A role with the setting sees and
-- writes only that workspace. A setting that is not a uuid is an error, so it fails closed.
--
-- What this file does NOT do, on purpose:
--   * It does not FORCE row level security. The owner (the app role) keeps working as before.
--   * It grants nothing to any role. On Supabase, anon and authenticated still see nothing.
--
-- A table with no org_id column would get a policy that allows nothing (today there is none).
-- Safe to run again: each policy is dropped before it is made.
-- A table added by a later migration needs its own policy in that migration. The test
-- src/server/domain/rls.db.test.ts fails when a pulse table has RLS on and no policy.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename,
           EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
           ) AS has_org
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'pulse' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE "pulse".%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "pulse_org_isolation" ON "pulse".%I', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "pulse_deny_all" ON "pulse".%I', t.tablename);
    IF t.has_org THEN
      EXECUTE format(
        'CREATE POLICY "pulse_org_isolation" ON "pulse".%I AS PERMISSIVE FOR ALL TO PUBLIC '
        || 'USING ("org_id" = (SELECT NULLIF(current_setting(''pulse.org_id'', true), '''')::uuid)) '
        || 'WITH CHECK ("org_id" = (SELECT NULLIF(current_setting(''pulse.org_id'', true), '''')::uuid))',
        t.tablename
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY "pulse_deny_all" ON "pulse".%I AS PERMISSIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
        t.tablename
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- The facts view reads production and extra service lines. By default a view reads its tables as
-- the view owner, which would skip the policies above. With security_invoker the view reads as
-- the role that asked, so the same policies apply through the view. The owner sees no change.
-- (security_invoker needs Postgres 15 or newer; an older server keeps the view as it was.)
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 AND to_regclass('pulse.v_facts') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW "pulse"."v_facts" SET (security_invoker = true)';
  END IF;
END $$;
