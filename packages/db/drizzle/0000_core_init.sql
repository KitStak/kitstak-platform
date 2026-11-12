-- 0000_core_init — core/crm/wms schemas + shared platform tables (BLUEPRINT.md §2.3).
-- Builds everything from zero against a fresh, empty database.
-- FKs targeting core.organization / core."user" (Better Auth tables that relocate into
-- core in Phase 3) are intentionally ABSENT here; they ship deferred in
-- 0001_core_fks.sql, which is NOT in meta/_journal.json. See drizzle/README.md.
CREATE SCHEMA IF NOT EXISTS "core";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "crm";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "wms";
--> statement-breakpoint
-- Shared company/depositor registry (canonicalizes wms.clients; CRM accounts link to it)
CREATE TABLE IF NOT EXISTS "core"."customers" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_org_idx" ON "core"."customers" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- Shared item/SKU registry (identity only; WMS keeps operational detail)
CREATE TABLE IF NOT EXISTS "core"."items" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  CONSTRAINT "items_org_id_customer_id_sku_unique" UNIQUE ("org_id", "customer_id", "sku"),
  CONSTRAINT "items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id")
    REFERENCES "core"."customers"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_barcode_idx" ON "core"."items" ("barcode");
--> statement-breakpoint
-- Billing / entitlements
CREATE TABLE IF NOT EXISTS "core"."stripe_customers" (
  "org_id"             uuid PRIMARY KEY,
  "stripe_customer_id" text NOT NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stripe_customers_stripe_customer_id_unique" UNIQUE ("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."entitlements" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 uuid NOT NULL,
  "module"                 text NOT NULL,
  "status"                 text NOT NULL,
  "source"                 text NOT NULL DEFAULT 'stripe',
  "stripe_subscription_id" text,
  "stripe_price_id"        text,
  "seats"                  integer,
  "current_period_end"     timestamptz,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "entitlements_org_id_module_unique" UNIQUE ("org_id", "module"),
  CONSTRAINT "entitlements_module_check" CHECK ("module" IN ('crm', 'wms')),
  CONSTRAINT "entitlements_status_check" CHECK ("status" IN ('active', 'trialing', 'past_due', 'canceled')),
  CONSTRAINT "entitlements_source_check" CHECK ("source" IN ('stripe', 'manual', 'trial'))
);
--> statement-breakpoint
-- Webhook idempotency ledger
CREATE TABLE IF NOT EXISTS "core"."billing_events" (
  "id"           text PRIMARY KEY,
  "type"         text NOT NULL,
  "payload"      jsonb NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Cross-app link bridges (keep each app's native model intact)
CREATE TABLE IF NOT EXISTS "crm"."customer_links" (
  "core_customer_id" uuid NOT NULL,
  "org_id"           uuid NOT NULL,
  "board_id"         uuid NOT NULL,
  "item_id"          uuid NOT NULL,
  CONSTRAINT "customer_links_pkey" PRIMARY KEY ("core_customer_id", "item_id"),
  CONSTRAINT "customer_links_core_customer_id_customers_id_fk" FOREIGN KEY ("core_customer_id")
    REFERENCES "core"."customers"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm"."core_item_links" (
  "core_item_id" uuid NOT NULL,
  "item_id"      uuid NOT NULL,
  "column_key"   text,
  CONSTRAINT "core_item_links_pkey" PRIMARY KEY ("core_item_id", "item_id"),
  CONSTRAINT "core_item_links_core_item_id_items_id_fk" FOREIGN KEY ("core_item_id")
    REFERENCES "core"."items"("id") ON DELETE CASCADE
);
--> statement-breakpoint
-- WMS user profile extension (WMS-only identity columns off core.user)
CREATE TABLE IF NOT EXISTS "wms"."user_profiles" (
  "user_id"             uuid PRIMARY KEY,
  "legacy_role"         text NOT NULL DEFAULT 'viewer',
  "user_type"           text NOT NULL DEFAULT 'Operation',
  "is_api_user"         boolean NOT NULL DEFAULT false,
  "all_clients"         boolean NOT NULL DEFAULT true,
  "preferences"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "password_changed_at" timestamptz,
  "last_login_at"       timestamptz
);
--> statement-breakpoint
-- RLS: deny-by-default on every created table — enabled, no policies (app connects as
-- owner; PostgREST and anon/authenticated roles see nothing). WMS pattern, extended.
ALTER TABLE "core"."customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."stripe_customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm"."customer_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm"."core_item_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wms"."user_profiles" ENABLE ROW LEVEL SECURITY;
