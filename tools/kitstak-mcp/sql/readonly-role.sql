-- Read-only Postgres role for the KitStak MCP server. NOT a migration: run it by hand, once,
-- as the `postgres` user (Supabase SQL editor or psql on the direct connection). Nothing in
-- the platform runs this file. Safe to re-run (it only grants).
--
--   psql "$DIRECT_URL" -v role_password='<strong password>' -v tenant_schema=wms \
--     -f tools/kitstak-mcp/sql/readonly-role.sql
--
-- tenant_schema: the org's WMS schema (the platform org is `wms`), from
--   SELECT t.schema_name FROM core.wms_tenants t JOIN core.organization o ON o.id = t.org_id
--   WHERE o.slug = '<org slug>';
-- Leave it out to skip the WMS. Add -v skip_crm=1 or -v skip_projects=1 to leave those out;
-- the server only offers tools for the apps the role can read.
--
-- What the role gets, all SELECT only:
--   WMS       every table in that one org's warehouse schema (other orgs' schemas: nothing)
--   CRM       workspaces, boards, columns, groups, items, item links, updates
--   Projects  projects, tasks, statuses, milestones, comments
--   Core      organization, wms_tenants, entitlements, member, and user id/name/title only
-- Never: sessions, accounts, passwords, verification tokens, CRM API tokens or webhooks,
-- billing ids, audit logs, any write.
--
-- CRM, Projects and core are shared by every org, so the grants cover all orgs' rows there;
-- the server filters every query to the one org it is configured for. BYPASSRLS is needed
-- because every app table has RLS on with no policies (to lock out Supabase's anon and
-- authenticated API roles); the table grants above are what limit the role.
--
-- Connect through the Supabase pooler as user `kitstak_mcp_ro.<project ref>`.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kitstak_mcp_ro') THEN
    CREATE ROLE kitstak_mcp_ro LOGIN NOINHERIT;
  END IF;
END $$;

ALTER ROLE kitstak_mcp_ro WITH LOGIN BYPASSRLS PASSWORD :'role_password';
ALTER ROLE kitstak_mcp_ro SET default_transaction_read_only = on;
ALTER ROLE kitstak_mcp_ro SET statement_timeout = '15s';

-- Core (portal): needed by every module.
GRANT USAGE ON SCHEMA core TO kitstak_mcp_ro;
GRANT SELECT ON core.organization, core.wms_tenants, core.entitlements, core.member TO kitstak_mcp_ro;
GRANT SELECT (id, name, title) ON core."user" TO kitstak_mcp_ro;

\if :{?tenant_schema}
GRANT USAGE ON SCHEMA :"tenant_schema" TO kitstak_mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA :"tenant_schema" TO kitstak_mcp_ro;
-- Tables the WMS adds to this schema later (run as the role that owns them, normally postgres).
ALTER DEFAULT PRIVILEGES IN SCHEMA :"tenant_schema" GRANT SELECT ON TABLES TO kitstak_mcp_ro;
\endif

\if :{?skip_crm}
\else
GRANT USAGE ON SCHEMA crm TO kitstak_mcp_ro;
GRANT SELECT ON crm.workspaces, crm.boards, crm.columns, crm.groups, crm.items, crm.item_links,
  crm.updates TO kitstak_mcp_ro;
\endif

\if :{?skip_projects}
\else
GRANT USAGE ON SCHEMA pm TO kitstak_mcp_ro;
GRANT SELECT ON pm.projects, pm.tasks, pm.statuses, pm.milestones, pm.comments TO kitstak_mcp_ro;
\endif
