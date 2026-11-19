-- The SET right on the plain role of the database guard (CONTRACTS section 12, rule 13).
--
-- 0009 step 2 granted pulse_app to the migration role only when
-- pg_has_role(current_user, 'pulse_app', 'MEMBER') was false. On PostgreSQL 16 and newer that is
-- the wrong question. A role with CREATEROLE that is not a superuser, and that makes pulse_app,
-- gets a membership with ADMIN only: INHERIT false and SET false (pg_auth_members). MEMBER is then
-- true, so 0009 skipped its GRANT, but SET ROLE pulse_app fails with "permission denied to set
-- role". The app could not use the role the moment PULSE_DB_GUARD=1 was set.
--
-- What this file does, in one step that is safe to run again:
--   - Nothing when pulse_app is missing (0009 said so with a NOTICE), or when the migration role is
--     a superuser (a superuser may become any role).
--   - On PostgreSQL 16 and newer: asks pg_has_role(current_user, 'pulse_app', 'SET'), the right
--     that SET ROLE needs, and when it is missing runs
--       GRANT pulse_app TO <migration role> WITH INHERIT FALSE, SET TRUE
--     The ADMIN only membership of the role that made pulse_app is allowed to do this.
--     INHERIT FALSE: the login does not take on the rights of pulse_app without SET ROLE.
--   - On PostgreSQL 15 and older (no SET option, MEMBER is the SET right): the plain GRANT when
--     MEMBER is false, as 0009 meant to.
--   - A grant the migration role is not allowed to make is skipped with a NOTICE that names the
--     SQL a database admin must run, and the migration still succeeds.
--
-- The grant goes to the role that runs the migration. When the app signs in as another role, a
-- database admin grants pulse_app to that role (CONTRACTS section 12, rule 13). /api/health with
-- the health token then answers guard ready true, from a real SET LOCAL ROLE.
DO $$
DECLARE
  modern constant boolean := current_setting('server_version_num')::int >= 160000;
  can_set boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    RAISE NOTICE 'pulse 0012: role pulse_app is missing, nothing to grant.';
    RETURN;
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  IF modern THEN
    can_set := pg_has_role(current_user, 'pulse_app', 'SET');
  ELSE
    can_set := pg_has_role(current_user, 'pulse_app', 'MEMBER');
  END IF;
  IF can_set THEN
    RETURN;
  END IF;
  IF modern THEN
    EXECUTE format('GRANT pulse_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT pulse_app TO %I', current_user);
  END IF;
  RAISE NOTICE 'pulse 0012: granted pulse_app to % so it can SET ROLE pulse_app.', current_user;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pulse 0012: skipped GRANT pulse_app TO % (not allowed). Ask a database admin to run: GRANT pulse_app TO % WITH SET TRUE;', current_user, current_user;
END $$;
