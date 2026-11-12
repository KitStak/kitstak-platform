-- 0009_core_business_sync — shared core business tables for WMS (BLUEPRINT.md §2.4, adapted).
--
-- 1. core.customers / core.items: on a WMS-local dev database (PGlite / own Postgres)
--    nothing has created them yet, so this migration builds them from scratch; on the
--    shared platform database packages/db drizzle/0000_core_init.sql already created them,
--    so every statement is guarded (IF NOT EXISTS / pg_constraint checks) and a no-op there.
--    DDL shape = packages/db/drizzle/0000_core_init.sql (§2.3 conventions).
-- 2. wms.products.core_item_id uuid — pointer to the product's core.items identity row,
--    maintained by src/server/repositories/core-sync.ts.
-- 3. Backfill: copies every existing wms.clients row into core.customers (id cast
--    text→uuid PRESERVING the value, so WMS text FKs keep joining via cast). org_id is
--    resolved at runtime: the first core.organization row, creating 'KitStak' when none
--    exists yet (blueprint §2.4 — all WMS rows implicitly belong to the platform org).
--    Products are NOT backfilled here: the repo sync creates core.items rows on the next
--    create/update, and seeds mirror everything in bulk (seed/index.ts finish()).
-- RLS: deny-by-default (enabled, no policies) — the app connects as the table owner.
CREATE SCHEMA IF NOT EXISTS "core";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."customers" (
	"id"            uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"org_id"        uuid NOT NULL,
	"code"          text NOT NULL,
	"name"          text NOT NULL,
	"official_name" text,
	"contact_name"  text,
	"contact_email" text,
	"phone"         text,
	"tax_id"        text,
	"currency"      text NOT NULL DEFAULT 'USD',
	"billing_plan"  text,
	"status"        text NOT NULL DEFAULT 'Active',
	"settings"      jsonb NOT NULL DEFAULT '{}'::jsonb,
	"custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at"    timestamptz NOT NULL DEFAULT now(),
	"updated_at"    timestamptz NOT NULL DEFAULT now(),
	"created_by"    uuid,
	"updated_by"    uuid,
	"version"       integer NOT NULL DEFAULT 1,
	"deleted_at"    timestamptz,
	CONSTRAINT "customers_org_id_code_unique" UNIQUE ("org_id", "code")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_org_idx" ON "core"."customers" ("org_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."items" (
	"id"            uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"org_id"        uuid NOT NULL,
	"customer_id"   uuid NOT NULL,
	"sku"           text NOT NULL,
	"name"          text NOT NULL,
	"barcode"       text,
	"uom"           text NOT NULL DEFAULT 'Each',
	"is_kit"        boolean NOT NULL DEFAULT false,
	"status"        text NOT NULL DEFAULT 'Active',
	"category"      text,
	"attrs"         jsonb NOT NULL DEFAULT '{}'::jsonb,
	"custom_fields" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at"    timestamptz NOT NULL DEFAULT now(),
	"updated_at"    timestamptz NOT NULL DEFAULT now(),
	"created_by"    uuid,
	"updated_by"    uuid,
	"version"       integer NOT NULL DEFAULT 1,
	"deleted_at"    timestamptz,
	CONSTRAINT "items_org_id_customer_id_sku_unique" UNIQUE ("org_id", "customer_id", "sku")
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_customer_id_customers_id_fk') THEN
    ALTER TABLE "core"."items" ADD CONSTRAINT "items_customer_id_customers_id_fk"
      FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_barcode_idx" ON "core"."items" ("barcode");--> statement-breakpoint
ALTER TABLE "core"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wms"."products" ADD COLUMN IF NOT EXISTS "core_item_id" uuid;--> statement-breakpoint
DO $$
DECLARE v_org uuid;
BEGIN
  SELECT "id" INTO v_org FROM "core"."organization" ORDER BY "created_at" ASC, "id" ASC LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO "core"."organization" ("id", "name", "slug", "created_at")
    VALUES (pg_catalog.gen_random_uuid(), 'KitStak', 'kitstak', now())
    RETURNING "id" INTO v_org;
  END IF;
  INSERT INTO "core"."customers"
    ("id", "org_id", "code", "name", "official_name", "contact_name", "contact_email",
     "phone", "tax_id", "currency", "billing_plan", "status", "settings", "custom_fields",
     "created_at", "updated_at")
  SELECT c."id"::uuid, v_org, c."code", c."name", NULLIF(c."official_name", ''),
         NULLIF(c."contact_name", ''), NULLIF(c."contact_email", ''), NULLIF(c."phone", ''),
         NULLIF(c."tax_id", ''), c."currency", c."billing_plan", c."status",
         COALESCE(c."settings", '{}'::jsonb), COALESCE(c."custom_fields", '{}'::jsonb),
         c."created_at"::timestamptz, c."updated_at"::timestamptz
  FROM "wms"."clients" c
  ON CONFLICT ("id") DO NOTHING;
END $$;
