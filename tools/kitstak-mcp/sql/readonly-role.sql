-- Read-only Postgres role for the KitStak MCP server. NOT a migration: run it by hand, once
-- per organization you want to expose, as the `postgres` user (Supabase SQL editor or psql
-- on the direct connection). Nothing in the platform runs this file.
--
--   psql "$DIRECT_URL" -v tenant_schema=wms_<org hex> -v role_password='<strong password>' \
--     -f tools/kitstak-mcp/sql/readonly-role.sql
--
-- Find the schema with: SELECT schema_name FROM core.wms_tenants t
--   JOIN core.organization o ON o.id = t.org_id WHERE o.slug = '<org slug>';
--
-- What the role can do: SELECT on that one warehouse schema, plus the two core tables the
-- server reads to find it. Nothing else: no other org's schema, no CRM, no auth tables, no
-- writes. BYPASSRLS is needed because every WMS table has RLS enabled with no policies (to
-- lock out Supabase's anon/authenticated API roles); the grants above are what limit it.
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

GRANT USAGE ON SCHEMA core TO kitstak_mcp_ro;
GRANT SELECT ON core.organization, core.wms_tenants TO kitstak_mcp_ro;

GRANT USAGE ON SCHEMA :"tenant_schema" TO kitstak_mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA :"tenant_schema" TO kitstak_mcp_ro;
-- Tables the WMS adds to this schema later (run as the role that owns them, normally postgres).
ALTER DEFAULT PRIVILEGES IN SCHEMA :"tenant_schema" GRANT SELECT ON TABLES TO kitstak_mcp_ro;
