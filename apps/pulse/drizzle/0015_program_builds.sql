-- Program builds feed Pulse (docs/programs/SPEC.md 2.3 and 6.1).
--
-- A program in Projects (recurring kitting work under one price card) can bill to one ongoing per
-- unit Pulse job, and a build can bill to its own job. Pulse copies the stored rows from Projects:
-- one production entry per build per day (`pmb:<buildId>:<date>`) and one revenue entry per posted
-- fee (`pmf:...`). It never computes program fees itself.
--
-- This adds:
--   production_entries.unit_price             the per row price snapshot from Projects (concrete on
--                                             every `pmb:` row, null on rows people type, so their
--                                             behavior does not change)
--   production_entries.material_cost_per_unit the variant's standard material cost at write time
--   production_entries.pm_program_id, pm_variant_id   and the same tags on revenue_entries, for
--                                             program and per variant reports
--   job_links target types pm_program and pm_build, with one link per program, one program per
--   job and one link per build (the mirror of core.record_links `bills_to` edges)
--   bridge_events kind pm_program_changed (Projects tells Pulse a program changed)
--   read and write on core.record_links for pulse_app, only for the org in `pulse.org_id`
--
-- Every existing row gets nulls, so nothing changes until a program links a job. Safe to run again.
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "unit_price" numeric(14,4);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_entries_unit_price_check') THEN
  ALTER TABLE "pulse"."production_entries" ADD CONSTRAINT "production_entries_unit_price_check" CHECK ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000)); END IF; END $$;
--> statement-breakpoint
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "material_cost_per_unit" numeric(14,4);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_entries_material_cost_check') THEN
  ALTER TABLE "pulse"."production_entries" ADD CONSTRAINT "production_entries_material_cost_check" CHECK ("material_cost_per_unit" IS NULL OR ("material_cost_per_unit" >= 0 AND "material_cost_per_unit" < 1000000)); END IF; END $$;
--> statement-breakpoint
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "pm_program_id" uuid;
--> statement-breakpoint
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "pm_variant_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_entries_variant_idx" ON "pulse"."production_entries" ("org_id","job_id","pm_variant_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_entries_program_day_idx" ON "pulse"."production_entries" ("org_id","pm_program_id","work_date") WHERE "pm_program_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pulse"."revenue_entries" ADD COLUMN IF NOT EXISTS "pm_program_id" uuid;
--> statement-breakpoint
ALTER TABLE "pulse"."revenue_entries" ADD COLUMN IF NOT EXISTS "pm_variant_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_entries_program_idx" ON "pulse"."revenue_entries" ("org_id","pm_program_id","revenue_date") WHERE "pm_program_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_links_target_type_check') THEN
    ALTER TABLE "pulse"."job_links" DROP CONSTRAINT "job_links_target_type_check"; END IF;
  ALTER TABLE "pulse"."job_links" ADD CONSTRAINT "job_links_target_type_check" CHECK ("target_type" IN ('crm_deal','crm_account','wms_work_order','wms_shipment_order','wms_client','pm_project','pm_task','pm_program','pm_build'));
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_links_program_key" ON "pulse"."job_links" ("org_id","target_id") WHERE "target_type" = 'pm_program';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_links_one_program_per_job" ON "pulse"."job_links" ("org_id","job_id") WHERE "target_type" = 'pm_program';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_links_build_key" ON "pulse"."job_links" ("org_id","target_id") WHERE "target_type" = 'pm_build';
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bridge_events_kind_check') THEN
    ALTER TABLE "pulse"."bridge_events" DROP CONSTRAINT "bridge_events_kind_check"; END IF;
  ALTER TABLE "pulse"."bridge_events" ADD CONSTRAINT "bridge_events_kind_check" CHECK ("kind" IN ('wms_work_order_changed','crm_deal_stage_changed','pm_time_logged','pm_program_changed'));
END $$;
--> statement-breakpoint
-- pulse_app links programs from Pulse inside its own transactions (0009 role). Rows of the org in
-- the `pulse.org_id` session setting only. Skipped with a NOTICE on a database without the table
-- (Pulse alone) or without the role.
DO $$
DECLARE org_setting text := 'nullif(current_setting(''pulse.org_id'', true), '''')::uuid';
BEGIN
  IF to_regclass('core.record_links') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    RAISE NOTICE 'pulse 0015: record_links grant skipped (table or role missing).'; RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON core.record_links TO pulse_app;
  DROP POLICY IF EXISTS "pulse_app_own_org_links" ON core.record_links;
  EXECUTE 'CREATE POLICY "pulse_app_own_org_links" ON core.record_links AS PERMISSIVE FOR ALL TO pulse_app USING ("org_id" = ' || org_setting || ') WITH CHECK ("org_id" = ' || org_setting || ')';
END $$;
