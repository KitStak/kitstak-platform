-- 0005_core_entitlements — shared core.entitlements for module gating (BLUEPRINT.md §3).
--
-- On a CRM-local dev database (embedded Postgres) nothing has created
-- core.entitlements yet, so this migration builds it; on the shared platform database
-- packages/db drizzle/0000_core_init.sql (+ 0001_core_fks.sql) already created it, so
-- every statement is guarded (IF NOT EXISTS / pg_constraint checks) and a no-op there.
-- DDL shape = packages/db/drizzle/0000_core_init.sql (§2.3 conventions).
--
-- Rows are written only by manual grants (`pnpm --filter @kitstak/entitlements grant`)
-- — Stripe sync is deferred by owner decision. Dev/test environments never read the
-- table (ENTITLEMENTS_DEV_ALLOW_ALL defaults on outside production).
-- RLS: deny-by-default (enabled, no policies) — the app connects as the table owner.
CREATE SCHEMA IF NOT EXISTS "core";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."entitlements" (
	"id"                     uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
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
);--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "core"."entitlements" ENABLE ROW LEVEL SECURITY;
