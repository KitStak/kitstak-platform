-- 0005_core_wms_tenants — one separate WMS warehouse (Postgres schema) per organization.
--
-- core.wms_tenants maps an organization to the schema that holds its WMS data. The
-- platform organization (slug `kitstak`) keeps the original `wms` schema, so no existing
-- data moves; every other org gets its own `wms_<org uuid hex>` schema, cloned from the
-- structure of `wms` when an owner/admin provisions the warehouse (apps/wms
-- src/server/tenancy). Cross-app readers (portal, CRM, Projects) resolve an org's schema
-- through this table instead of hard-coding `wms.`.
--
-- Mirrored (guarded, idempotent) by apps/wms/drizzle/0012_core_wms_tenants.sql so a
-- WMS-only database (PGlite tests, local dev) gets the same table.
CREATE TABLE IF NOT EXISTS "core"."wms_tenants" (
	"org_id"         uuid PRIMARY KEY,
	"schema_name"    text NOT NULL,
	"status"         text NOT NULL DEFAULT 'provisioning',
	"created_at"     timestamptz NOT NULL DEFAULT now(),
	"provisioned_at" timestamptz,
	"provisioned_by" uuid,
	CONSTRAINT "wms_tenants_schema_name_unique" UNIQUE ("schema_name"),
	CONSTRAINT "wms_tenants_schema_name_check" CHECK ("schema_name" ~ '^wms(_[0-9a-f]{32})?$'),
	CONSTRAINT "wms_tenants_status_check" CHECK ("status" IN ('provisioning', 'active'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wms_tenants_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."wms_tenants" ADD CONSTRAINT "wms_tenants_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."wms_tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The platform org already owns the original `wms` schema (when both exist).
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL AND to_regclass('wms.warehouses') IS NOT NULL THEN
    INSERT INTO "core"."wms_tenants" ("org_id", "schema_name", "status", "provisioned_at")
    SELECT o."id", 'wms', 'active', now()
    FROM "core"."organization" o
    WHERE o."slug" = 'kitstak'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
