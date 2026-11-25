-- 0007_core_record_links: one link graph for any record to any record.
--
-- Programs, projects, Pulse jobs, builds, customers, CRM deals and accounts, variants and WMS
-- records are independent. Any of them can be tied to any other through core.record_links
-- (docs/programs/SPEC.md 1.2 and 2.1). Legacy link tables (pm.integration_links,
-- pulse.job_links, the CRM bridges) stay; nothing is migrated or dropped.
--
-- Money edges are only `bills_to`, and the partial unique indexes keep the money shape in one
-- place: one Pulse job per program, one per build, and one program per job. `uses_kit` allows one
-- kit per variant per target type (one core item, one WMS product).
--
-- Writers go through @kitstak/db/record-links, which stores one edge per pair (direction
-- normalized) and keeps cached_url a path. RLS is enabled with no policy (core pattern); Pulse
-- 0015 adds the one pulse_app policy. Safe to run again.
CREATE TABLE IF NOT EXISTS "core"."record_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "from_type" text NOT NULL,
  "from_id" text NOT NULL,
  "to_type" text NOT NULL,
  "to_id" text NOT NULL,
  "relation" text NOT NULL DEFAULT 'related',
  "cached_title" text,
  "cached_status" text,
  "cached_url" text,
  "cached_at" timestamptz,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "record_links_from_type_check" CHECK ("from_type" IN ('core_customer','core_item','crm_deal','crm_account','pm_project','pm_program','pm_task','pm_build','pm_variant','pulse_job','wms_work_order','wms_shipment_order','wms_client','wms_product')),
  CONSTRAINT "record_links_to_type_check" CHECK ("to_type" IN ('core_customer','core_item','crm_deal','crm_account','pm_project','pm_program','pm_task','pm_build','pm_variant','pulse_job','wms_work_order','wms_shipment_order','wms_client','wms_product')),
  CONSTRAINT "record_links_relation_check" CHECK ("relation" IN ('related','belongs_to','bills_to','uses_kit','created_from')),
  CONSTRAINT "record_links_not_self_check" CHECK (("from_type","from_id") <> ("to_type","to_id")),
  CONSTRAINT "record_links_cached_url_check" CHECK ("cached_url" IS NULL OR ("cached_url" LIKE '/%' AND "cached_url" NOT LIKE '//%')),
  CONSTRAINT "record_links_bills_to_shape_check" CHECK ("relation" <> 'bills_to' OR ("from_type" IN ('pm_program','pm_build') AND "to_type" = 'pulse_job')),
  CONSTRAINT "record_links_uses_kit_shape_check" CHECK ("relation" <> 'uses_kit' OR ("from_type" = 'pm_variant' AND "to_type" IN ('core_item','wms_product')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_edge_key" ON "core"."record_links" ("org_id","from_type","from_id","to_type","to_id","relation");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_links_from_idx" ON "core"."record_links" ("org_id","from_type","from_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_links_to_idx" ON "core"."record_links" ("org_id","to_type","to_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_job_per_program" ON "core"."record_links" ("org_id","from_id") WHERE "from_type" = 'pm_program' AND "relation" = 'bills_to';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_job_per_build" ON "core"."record_links" ("org_id","from_id") WHERE "from_type" = 'pm_build' AND "relation" = 'bills_to';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_program_per_job" ON "core"."record_links" ("org_id","to_id") WHERE "from_type" = 'pm_program' AND "relation" = 'bills_to';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_links_one_kit_per_variant" ON "core"."record_links" ("org_id","from_id","to_type") WHERE "relation" = 'uses_kit';
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_links_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."record_links" ADD CONSTRAINT "record_links_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core."user"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_links_created_by_user_id_fk') THEN
    ALTER TABLE "core"."record_links" ADD CONSTRAINT "record_links_created_by_user_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "core"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."record_links" ENABLE ROW LEVEL SECURITY;
