-- core.onboarding_progress: durable guided-setup state shared by portal, CRM and WMS.
-- Derived steps (counts of members/boards/warehouses/orders) are never stored; rows exist
-- only for explicit actions: wizard answers ('profile'), skips, and guide dismissals.
CREATE TABLE IF NOT EXISTS "core"."onboarding_progress" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL,
  "user_id"      uuid,
  "scope"        text NOT NULL,
  "step_key"     text NOT NULL,
  "status"       text NOT NULL DEFAULT 'completed',
  "payload"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "completed_by" uuid,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "onboarding_progress_org_scope_step_user_unique"
    UNIQUE ("org_id", "scope", "step_key", "user_id"),
  CONSTRAINT "onboarding_progress_scope_check"
    CHECK ("scope" IN ('portal', 'crm', 'wms')),
  CONSTRAINT "onboarding_progress_status_check"
    CHECK ("status" IN ('completed', 'skipped', 'dismissed'))
);
--> statement-breakpoint
-- Postgres UNIQUE treats NULLs as distinct; org-level (user_id IS NULL) upserts conflict
-- against this partial index instead.
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_progress_org_scope_step_org_level_unique"
  ON "core"."onboarding_progress" ("org_id", "scope", "step_key")
  WHERE "user_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_progress_org_id_idx"
  ON "core"."onboarding_progress" ("org_id");
--> statement-breakpoint
-- FKs guarded on the target tables, 0001_core_fks pattern: packages/db migrations may run
-- standalone before the CRM migrations relocate the Better Auth tables into `core`.
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_progress_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."onboarding_progress" ADD CONSTRAINT "onboarding_progress_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
  END IF;
  IF to_regclass('core."user"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_progress_user_id_user_id_fk') THEN
      ALTER TABLE "core"."onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_progress_completed_by_user_id_fk') THEN
      ALTER TABLE "core"."onboarding_progress" ADD CONSTRAINT "onboarding_progress_completed_by_user_id_fk"
        FOREIGN KEY ("completed_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."onboarding_progress" ENABLE ROW LEVEL SECURITY;
