-- Programs: recurring kitting work under one price card. Adds kind to projects, tasks and templates,
-- a surface to saved views, a workspace calendar, and the program side tables.
--
-- docs/programs/SPEC.md section 2.2. A program is a pm.projects row with kind = 'program'; a build is
-- a pm.tasks row with kind = 'build' and a 1 to 1 pm.builds row. Existing rows default to 'project',
-- 'task', project templates and 'work' views, so nothing changes for people who never make a program
-- (ADD COLUMN ... DEFAULT with a constant is metadata only).
--
-- Guard triggers (SQLSTATE KP101 to KP105) keep builds top level, kinds fixed, build moves inside
-- the domain (`pm.build_move` transaction setting) and pm.builds consistent with its task. The
-- finish trigger keeps pm.builds.finished_on in step with the task status on every status path.
--
-- Every new table: org_id with FK core.organization ON DELETE CASCADE, RLS enabled (no policies),
-- enums as text with a named CHECK, live partial indexes where soft delete exists, and a version
-- column on every mutable table (optimistic concurrency). Safe to run again: tables and indexes use
-- IF NOT EXISTS, constraints on existing tables sit in DO blocks that check pg_constraint.

-- 2.2.1 Kind columns -------------------------------------------------------------------------------
ALTER TABLE "pm"."projects" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'project';
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_kind_check') THEN
  ALTER TABLE "pm"."projects" ADD CONSTRAINT "projects_kind_check" CHECK ("kind" IN ('project','program')); END IF; END $$;
--> statement-breakpoint
ALTER TABLE "pm"."tasks" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'task';
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_kind_check') THEN
  ALTER TABLE "pm"."tasks" ADD CONSTRAINT "tasks_kind_check" CHECK ("kind" IN ('task','build')); END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_build_no_recurrence_check') THEN
  ALTER TABLE "pm"."tasks" ADD CONSTRAINT "tasks_build_no_recurrence_check" CHECK ("kind" <> 'build' OR "recurrence" IS NULL); END IF; END $$;
--> statement-breakpoint
ALTER TABLE "pm"."templates" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'project';
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'templates_kind_check') THEN
  ALTER TABLE "pm"."templates" ADD CONSTRAINT "templates_kind_check" CHECK ("kind" IN ('project','program')); END IF; END $$;
--> statement-breakpoint
ALTER TABLE "pm"."saved_views" ADD COLUMN IF NOT EXISTS "surface" text NOT NULL DEFAULT 'work';
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_views_surface_check') THEN
  ALTER TABLE "pm"."saved_views" ADD CONSTRAINT "saved_views_surface_check" CHECK ("surface" IN ('work','programs','floor')); END IF; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_kind_idx" ON "pm"."projects" ("org_id","kind") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_org_kind_assignee_idx" ON "pm"."tasks" ("org_id","kind","assignee_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_kind_due_idx" ON "pm"."tasks" ("project_id","kind","due_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_project_started_idx" ON "pm"."time_entries" ("project_id","started_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_org_kind_idx" ON "pm"."templates" ("org_id","kind") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- 2.2.2 CHECK widenings: notification kind 'program' ------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_kind_check'
             AND pg_get_constraintdef(oid) NOT LIKE '%''program''%') THEN
    ALTER TABLE "pm"."notifications" DROP CONSTRAINT "notifications_kind_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_kind_check') THEN
    ALTER TABLE "pm"."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('mention', 'assigned', 'comment', 'status_changed', 'due_soon', 'overdue', 'watching', 'automation', 'integration', 'project', 'program'));
  END IF;
END $$;
--> statement-breakpoint

-- 2.2.3 pm.org_calendar ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."org_calendar" (
  "org_id" uuid PRIMARY KEY REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "timezone" text NOT NULL DEFAULT 'America/Chicago',
  "working_days" smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  "holidays" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "daily_capacity_hours" numeric(10,2),
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "org_calendar_timezone_check" CHECK (char_length("timezone") BETWEEN 1 AND 64),
  CONSTRAINT "org_calendar_working_days_check" CHECK ("working_days" <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality("working_days") BETWEEN 1 AND 7),
  CONSTRAINT "org_calendar_holidays_check" CHECK (jsonb_typeof("holidays") = 'array' AND jsonb_array_length("holidays") <= 100),
  CONSTRAINT "org_calendar_capacity_check" CHECK ("daily_capacity_hours" IS NULL OR "daily_capacity_hours" > 0)
);
--> statement-breakpoint
ALTER TABLE "pm"."org_calendar" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.4 pm.program_settings ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."program_settings" (
  "program_id" uuid PRIMARY KEY REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "unit_singular" text NOT NULL DEFAULT 'kit',
  "unit_plural" text NOT NULL DEFAULT 'kits',
  "timezone" text NOT NULL,
  "working_days" smallint[],
  "use_org_holidays" boolean NOT NULL DEFAULT true,
  "extra_days_off" date[] NOT NULL DEFAULT '{}',
  "extra_work_days" date[] NOT NULL DEFAULT '{}',
  "currency" text NOT NULL DEFAULT 'USD',
  "monthly_target_cents" bigint,
  "daily_target_units" numeric(14,3),
  "build_title_pattern" text NOT NULL DEFAULT '{variant} · {date}',
  "auto_start_on_output" boolean NOT NULL DEFAULT true,
  "auto_done_when_full" boolean NOT NULL DEFAULT true,
  "money_min_role" text NOT NULL DEFAULT 'editor',
  "hourly_time_basis" text NOT NULL DEFAULT 'billable',
  "remind_at" time DEFAULT '18:00',
  "paused_ranges" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "locked_through" date,
  "settled_through" date,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "program_settings_unit_singular_check" CHECK (char_length("unit_singular") BETWEEN 1 AND 24),
  CONSTRAINT "program_settings_unit_plural_check" CHECK (char_length("unit_plural") BETWEEN 1 AND 24),
  CONSTRAINT "program_settings_timezone_check" CHECK (char_length("timezone") BETWEEN 1 AND 64),
  CONSTRAINT "program_settings_working_days_check" CHECK ("working_days" IS NULL OR ("working_days" <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality("working_days") BETWEEN 1 AND 7)),
  CONSTRAINT "program_settings_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "program_settings_target_check" CHECK ("monthly_target_cents" IS NULL OR "monthly_target_cents" >= 0),
  CONSTRAINT "program_settings_daily_target_check" CHECK ("daily_target_units" IS NULL OR "daily_target_units" >= 0),
  CONSTRAINT "program_settings_title_pattern_check" CHECK (char_length("build_title_pattern") BETWEEN 1 AND 120),
  CONSTRAINT "program_settings_money_min_role_check" CHECK ("money_min_role" IN ('owner','editor','commenter','viewer')),
  CONSTRAINT "program_settings_hourly_time_basis_check" CHECK ("hourly_time_basis" IN ('billable','all')),
  CONSTRAINT "program_settings_paused_ranges_check" CHECK (jsonb_typeof("paused_ranges") = 'array')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_settings_org_idx" ON "pm"."program_settings" ("org_id");
--> statement-breakpoint
ALTER TABLE "pm"."program_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.5 pm.program_attributes ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."program_attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "values" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "position" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "program_attributes_name_check" CHECK (char_length("name") BETWEEN 1 AND 40),
  CONSTRAINT "program_attributes_values_check" CHECK (jsonb_typeof("values") = 'array' AND jsonb_array_length("values") <= 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_attributes_program_name_live" ON "pm"."program_attributes" ("program_id", lower("name")) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."program_attributes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.6 pm.program_variants ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."program_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sku" text,
  "default_qty" numeric(14,3),
  "pack_qty" numeric(14,3),
  "std_minutes_per_unit" numeric(10,3),
  "material_cost_per_unit" numeric(14,4),
  "core_item_id" uuid,
  "wms_product_id" text,
  "color" text,
  "position" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "program_variants_key_check" CHECK ("key" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  CONSTRAINT "program_variants_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "program_variants_attributes_check" CHECK (jsonb_typeof("attributes") = 'object'),
  CONSTRAINT "program_variants_sku_check" CHECK ("sku" IS NULL OR char_length("sku") BETWEEN 1 AND 64),
  CONSTRAINT "program_variants_default_qty_check" CHECK ("default_qty" IS NULL OR "default_qty" > 0),
  CONSTRAINT "program_variants_pack_qty_check" CHECK ("pack_qty" IS NULL OR "pack_qty" > 0),
  CONSTRAINT "program_variants_std_minutes_check" CHECK ("std_minutes_per_unit" IS NULL OR "std_minutes_per_unit" > 0),
  CONSTRAINT "program_variants_material_cost_check" CHECK ("material_cost_per_unit" IS NULL OR ("material_cost_per_unit" >= 0 AND "material_cost_per_unit" < 1000000)),
  CONSTRAINT "program_variants_status_check" CHECK ("status" IN ('active','retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_variants_program_key_live" ON "pm"."program_variants" ("program_id","key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_variants_program_name_live" ON "pm"."program_variants" ("program_id", lower("name")) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_variants_program_sku_live" ON "pm"."program_variants" ("program_id","sku") WHERE "deleted_at" IS NULL AND "sku" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_variants_core_item_idx" ON "pm"."program_variants" ("org_id","core_item_id") WHERE "core_item_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_variants_wms_product_idx" ON "pm"."program_variants" ("org_id","wms_product_id") WHERE "wms_product_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."program_variants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.7 pm.price_card_versions ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."price_card_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "number" integer,
  "status" text NOT NULL DEFAULT 'draft',
  "effective_from" date NOT NULL,
  "label" text,
  "note" text,
  "source" text NOT NULL DEFAULT 'manual',
  "source_ref" text,
  "review_status" text NOT NULL DEFAULT 'none',
  "review_note" text,
  "review_requested_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "review_requested_at" timestamptz,
  "published_at" timestamptz,
  "published_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "price_card_versions_number_check" CHECK ("number" IS NULL OR "number" > 0),
  CONSTRAINT "price_card_versions_status_check" CHECK ("status" IN ('draft','published')),
  CONSTRAINT "price_card_versions_label_check" CHECK ("label" IS NULL OR char_length("label") <= 60),
  CONSTRAINT "price_card_versions_note_check" CHECK ("note" IS NULL OR char_length("note") <= 2000),
  CONSTRAINT "price_card_versions_source_check" CHECK ("source" IN ('manual','crm_deal','copy','template','seed','variant_tab')),
  CONSTRAINT "price_card_versions_review_status_check" CHECK ("review_status" IN ('none','waiting','sent_back')),
  CONSTRAINT "price_card_versions_review_note_check" CHECK ("review_note" IS NULL OR char_length("review_note") <= 500),
  CONSTRAINT "price_card_versions_published_check" CHECK ("status" <> 'published' OR ("number" IS NOT NULL AND "published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_card_versions_program_number_key" ON "pm"."price_card_versions" ("program_id","number") WHERE "number" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_card_versions_published_day_key" ON "pm"."price_card_versions" ("program_id","effective_from") WHERE "status" = 'published' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_card_versions_pending_day_key" ON "pm"."price_card_versions" ("program_id","effective_from") WHERE "status" = 'draft' AND "source" = 'variant_tab' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_card_versions_program_status_idx" ON "pm"."price_card_versions" ("program_id","status","effective_from") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."price_card_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.8 pm.price_card_rules and pm.price_card_lines ------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."price_card_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "version_id" uuid NOT NULL REFERENCES "pm"."price_card_versions"("id") ON DELETE CASCADE,
  "attribute_id" uuid NOT NULL REFERENCES "pm"."program_attributes"("id") ON DELETE RESTRICT,
  "value_id" text NOT NULL,
  "op" text NOT NULL,
  "amount" numeric(14,4) NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  CONSTRAINT "price_card_rules_op_check" CHECK ("op" IN ('add','set')),
  CONSTRAINT "price_card_rules_amount_check" CHECK ("amount" > -1000000 AND "amount" < 1000000),
  CONSTRAINT "price_card_rules_set_amount_check" CHECK ("op" <> 'set' OR "amount" >= 0),
  CONSTRAINT "price_card_rules_value_key" UNIQUE ("version_id","attribute_id","value_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_card_rules_attribute_idx" ON "pm"."price_card_rules" ("attribute_id");
--> statement-breakpoint
ALTER TABLE "pm"."price_card_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pm"."price_card_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "version_id" uuid NOT NULL REFERENCES "pm"."price_card_versions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "variant_id" uuid REFERENCES "pm"."program_variants"("id") ON DELETE RESTRICT,
  "rule_id" uuid REFERENCES "pm"."price_card_rules"("id") ON DELETE CASCADE,
  "unit_price" numeric(14,4),
  "rate_cents" integer,
  "amount_cents" bigint,
  "prorate" boolean NOT NULL DEFAULT true,
  "charge_while_paused" boolean NOT NULL DEFAULT true,
  "label" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "price_card_lines_kind_check" CHECK ("kind" IN ('per_unit','per_order','per_hour','flat_monthly','monthly_minimum')),
  CONSTRAINT "price_card_lines_variant_check" CHECK ("variant_id" IS NULL OR "kind" IN ('per_unit','per_order')),
  CONSTRAINT "price_card_lines_rule_check" CHECK ("rule_id" IS NULL OR ("kind" = 'per_unit' AND "variant_id" IS NOT NULL)),
  CONSTRAINT "price_card_lines_unit_price_check" CHECK ((("kind" = 'per_unit') = ("unit_price" IS NOT NULL)) AND ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000))),
  CONSTRAINT "price_card_lines_rate_cents_check" CHECK ((("kind" = 'per_hour') = ("rate_cents" IS NOT NULL)) AND ("rate_cents" IS NULL OR ("rate_cents" >= 0 AND "rate_cents" <= 10000000))),
  CONSTRAINT "price_card_lines_amount_cents_check" CHECK ((("kind" IN ('per_order','flat_monthly','monthly_minimum')) = ("amount_cents" IS NOT NULL)) AND ("amount_cents" IS NULL OR ("amount_cents" >= 0 AND "amount_cents" <= 10000000000000))),
  CONSTRAINT "price_card_lines_label_check" CHECK ("label" IS NULL OR char_length("label") <= 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_card_lines_version_kind_variant_key" ON "pm"."price_card_lines" ("version_id","kind", coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_card_lines_variant_idx" ON "pm"."price_card_lines" ("variant_id") WHERE "variant_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pm"."price_card_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.9 pm.program_one_time_charges ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."program_one_time_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "charge_on" date NOT NULL,
  "amount_cents" bigint NOT NULL,
  "label" text NOT NULL,
  "reason" text,
  "variant_id" uuid REFERENCES "pm"."program_variants"("id") ON DELETE SET NULL,
  "counts_toward_minimum" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "program_one_time_charges_kind_check" CHECK ("kind" IN ('setup','adjustment')),
  CONSTRAINT "program_one_time_charges_amount_check" CHECK (("kind" <> 'setup' OR "amount_cents" > 0) AND ("kind" <> 'adjustment' OR "amount_cents" <> 0) AND abs("amount_cents") <= 10000000000000),
  CONSTRAINT "program_one_time_charges_label_check" CHECK (char_length("label") BETWEEN 1 AND 80),
  CONSTRAINT "program_one_time_charges_reason_check" CHECK (("kind" <> 'adjustment' OR "reason" IS NOT NULL) AND ("reason" IS NULL OR char_length("reason") <= 500)),
  CONSTRAINT "program_one_time_charges_variant_check" CHECK ("kind" = 'adjustment' OR "variant_id" IS NULL),
  CONSTRAINT "program_one_time_charges_minimum_check" CHECK ("kind" = 'adjustment' OR "counts_toward_minimum" = false)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_one_time_charges_program_day_idx" ON "pm"."program_one_time_charges" ("program_id","charge_on") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."program_one_time_charges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.14 pm.build_schedules and pm.build_schedule_lines (before pm.builds, which points at them) --
CREATE TABLE IF NOT EXISTS "pm"."build_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "pattern" text NOT NULL,
  "days" smallint[] NOT NULL DEFAULT '{}',
  "interval_weeks" smallint NOT NULL DEFAULT 1,
  "starts_on" date NOT NULL,
  "ends_on" date,
  "lead_days" smallint NOT NULL DEFAULT 7,
  "skip_holidays" boolean NOT NULL DEFAULT true,
  "skip_dates" date[] NOT NULL DEFAULT '{}',
  "default_assignee_id" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "default_status_id" uuid REFERENCES "pm"."statuses"("id") ON DELETE SET NULL,
  "generated_through" date,
  "last_run_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "build_schedules_name_check" CHECK (char_length("name") BETWEEN 1 AND 60),
  CONSTRAINT "build_schedules_status_check" CHECK ("status" IN ('active','paused','ended')),
  CONSTRAINT "build_schedules_pattern_check" CHECK ("pattern" IN ('daily','weekdays','custom_days','every_n_weeks')),
  CONSTRAINT "build_schedules_days_check" CHECK ("days" <@ '{0,1,2,3,4,5,6}'::smallint[]),
  CONSTRAINT "build_schedules_interval_check" CHECK ("interval_weeks" BETWEEN 1 AND 12),
  CONSTRAINT "build_schedules_ends_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on"),
  CONSTRAINT "build_schedules_lead_days_check" CHECK ("lead_days" BETWEEN 0 AND 60)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_schedules_program_idx" ON "pm"."build_schedules" ("program_id","status") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_schedules_org_active_idx" ON "pm"."build_schedules" ("org_id") WHERE "status" = 'active' AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."build_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pm"."build_schedule_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "schedule_id" uuid NOT NULL REFERENCES "pm"."build_schedules"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "pm"."program_variants"("id") ON DELETE CASCADE,
  "qty" numeric(14,3) NOT NULL,
  "qty_by_weekday" jsonb,
  "assignee_id" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "position" integer NOT NULL DEFAULT 0,
  CONSTRAINT "build_schedule_lines_qty_check" CHECK ("qty" > 0 AND "qty" < 100000000),
  CONSTRAINT "build_schedule_lines_by_weekday_check" CHECK ("qty_by_weekday" IS NULL OR jsonb_typeof("qty_by_weekday") = 'object'),
  CONSTRAINT "build_schedule_lines_variant_key" UNIQUE ("schedule_id","variant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_schedule_lines_variant_idx" ON "pm"."build_schedule_lines" ("variant_id");
--> statement-breakpoint
ALTER TABLE "pm"."build_schedule_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.10 pm.builds ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."builds" (
  "task_id" uuid PRIMARY KEY REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "container_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "program_id" uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "variant_id" uuid REFERENCES "pm"."program_variants"("id") ON DELETE RESTRICT,
  "build_date" date NOT NULL,
  "planned_qty" numeric(14,3) NOT NULL,
  "planned_from" text NOT NULL DEFAULT 'manual',
  "built_qty" numeric(14,3) NOT NULL DEFAULT 0,
  "scrap_qty" numeric(14,3) NOT NULL DEFAULT 0,
  "rate_override" numeric(14,4),
  "rate_override_reason" text,
  "unplanned" boolean NOT NULL DEFAULT false,
  "closed_short" boolean NOT NULL DEFAULT false,
  "close_reason" text,
  "split_from_id" uuid REFERENCES "pm"."builds"("task_id") ON DELETE SET NULL,
  "first_finished_on" date,
  "finished_on" date,
  "schedule_id" uuid REFERENCES "pm"."build_schedules"("id") ON DELETE SET NULL,
  "schedule_date" date,
  "occurrence_variant_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "builds_planned_qty_check" CHECK ("planned_qty" > 0 AND "planned_qty" < 100000000),
  CONSTRAINT "builds_planned_from_check" CHECK ("planned_from" IN ('manual','schedule','variant_default','planner','unplanned','split','import','form')),
  CONSTRAINT "builds_built_qty_check" CHECK ("built_qty" >= 0),
  CONSTRAINT "builds_scrap_qty_check" CHECK ("scrap_qty" >= 0),
  CONSTRAINT "builds_rate_override_check" CHECK ("rate_override" IS NULL OR ("rate_override" >= 0 AND "rate_override" < 1000000)),
  CONSTRAINT "builds_rate_override_reason_check" CHECK (("rate_override" IS NULL OR "rate_override_reason" IS NOT NULL) AND ("rate_override_reason" IS NULL OR char_length("rate_override_reason") <= 200)),
  CONSTRAINT "builds_close_reason_check" CHECK ((NOT "closed_short" OR "close_reason" IS NOT NULL) AND ("close_reason" IS NULL OR char_length("close_reason") <= 200)),
  CONSTRAINT "builds_variant_needs_program_check" CHECK ("program_id" IS NOT NULL OR "variant_id" IS NULL),
  CONSTRAINT "builds_schedule_occurrence_check" CHECK ("schedule_id" IS NULL OR ("schedule_date" IS NOT NULL AND "occurrence_variant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_container_date_idx" ON "pm"."builds" ("container_id","build_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_program_variant_date_idx" ON "pm"."builds" ("program_id","variant_id","build_date") WHERE "program_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_open_idx" ON "pm"."builds" ("org_id","build_date") WHERE "finished_on" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_program_finished_idx" ON "pm"."builds" ("program_id","finished_on") WHERE "finished_on" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_variant_idx" ON "pm"."builds" ("variant_id") WHERE "variant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "builds_schedule_occurrence_key" ON "pm"."builds" ("schedule_id","schedule_date","occurrence_variant_id") WHERE "schedule_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pm"."builds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.11 pm.build_output ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."build_output" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "container_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "program_id" uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "build_id" uuid NOT NULL REFERENCES "pm"."builds"("task_id") ON DELETE CASCADE,
  "variant_id" uuid,
  "work_date" date NOT NULL,
  "qty" numeric(14,3) NOT NULL,
  "scrap_qty" numeric(14,3) NOT NULL DEFAULT 0,
  "unit_price" numeric(14,4) NOT NULL,
  "price_source" text NOT NULL,
  "card_version_id" uuid,
  "revenue_cents" bigint NOT NULL DEFAULT 0,
  "posting" text NOT NULL,
  "pulse_job_id" uuid,
  "source" text NOT NULL DEFAULT 'manual',
  "note" text,
  "entered_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "build_output_qty_check" CHECK ("qty" >= 0 AND "qty" < 100000000),
  CONSTRAINT "build_output_scrap_qty_check" CHECK ("scrap_qty" >= 0 AND "scrap_qty" < 100000000),
  CONSTRAINT "build_output_unit_price_check" CHECK ("unit_price" >= 0 AND "unit_price" < 1000000),
  CONSTRAINT "build_output_price_source_check" CHECK ("price_source" IN ('build','variant','card','job','none')),
  CONSTRAINT "build_output_no_price_check" CHECK ("price_source" <> 'none' OR "unit_price" = 0),
  CONSTRAINT "build_output_posting_check" CHECK ("posting" IN ('program','program_job','build_job','unbilled')),
  CONSTRAINT "build_output_job_check" CHECK (("posting" IN ('program_job','build_job')) = ("pulse_job_id" IS NOT NULL)),
  CONSTRAINT "build_output_source_check" CHECK ("source" IN ('manual','scan','import','form')),
  CONSTRAINT "build_output_note_check" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "build_output_build_day_key" ON "pm"."build_output" ("build_id","work_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_output_program_day_idx" ON "pm"."build_output" ("org_id","program_id","work_date") INCLUDE ("variant_id","qty","revenue_cents") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_output_container_day_idx" ON "pm"."build_output" ("org_id","container_id","work_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_output_job_day_idx" ON "pm"."build_output" ("org_id","pulse_job_id","work_date") WHERE "pulse_job_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."build_output" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.12 pm.program_ledger -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."program_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "ref" text NOT NULL,
  "kind" text NOT NULL,
  "charge_date" date NOT NULL,
  "month" date NOT NULL,
  "cents" bigint NOT NULL,
  "quantity" numeric(14,3),
  "unit_price" numeric(14,4),
  "variant_id" uuid,
  "build_id" uuid,
  "version_id" uuid,
  "line_id" uuid,
  "one_time_id" uuid,
  "label" text NOT NULL,
  "counts_toward_minimum" boolean NOT NULL DEFAULT false,
  "posting" text NOT NULL,
  "pulse_job_id" uuid,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "program_ledger_kind_check" CHECK ("kind" IN ('per_order','per_hour','flat_monthly','setup','adjustment','minimum_top_up')),
  CONSTRAINT "program_ledger_ref_check" CHECK ("ref" LIKE 'pmf:%'),
  CONSTRAINT "program_ledger_month_check" CHECK ("month" = date_trunc('month', "charge_date")::date),
  CONSTRAINT "program_ledger_label_check" CHECK (char_length("label") BETWEEN 1 AND 200),
  CONSTRAINT "program_ledger_posting_check" CHECK ("posting" IN ('program','program_job')),
  CONSTRAINT "program_ledger_job_check" CHECK (("posting" = 'program_job') = ("pulse_job_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_ledger_ref_key" ON "pm"."program_ledger" ("org_id","ref") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_ledger_program_month_idx" ON "pm"."program_ledger" ("org_id","program_id","month") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."program_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.13 pm.program_closes -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."program_closes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "month" date NOT NULL,
  "total_cents" bigint NOT NULL,
  "units" numeric(14,3) NOT NULL,
  "checklist" jsonb NOT NULL,
  "closed_by" uuid NOT NULL,
  "closed_at" timestamptz NOT NULL,
  "reopened_by" uuid,
  "reopened_at" timestamptz,
  "reopen_reason" text,
  CONSTRAINT "program_closes_month_check" CHECK (extract(day FROM "month") = 1),
  CONSTRAINT "program_closes_reopen_check" CHECK ("reopened_at" IS NULL OR "reopen_reason" IS NOT NULL),
  CONSTRAINT "program_closes_reason_check" CHECK ("reopen_reason" IS NULL OR char_length("reopen_reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "program_closes_program_month_key" ON "pm"."program_closes" ("program_id","month") WHERE "reopened_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_closes_program_idx" ON "pm"."program_closes" ("org_id","program_id","month");
--> statement-breakpoint
ALTER TABLE "pm"."program_closes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.15 pm.wizard_drafts --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pm"."wizard_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL DEFAULT 'Untitled program',
  "step" smallint NOT NULL DEFAULT 0,
  "payload" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wizard_drafts_kind_check" CHECK ("kind" IN ('program')),
  CONSTRAINT "wizard_drafts_title_check" CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT "wizard_drafts_step_check" CHECK ("step" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wizard_drafts_user_idx" ON "pm"."wizard_drafts" ("org_id","user_id","updated_at" DESC);
--> statement-breakpoint
ALTER TABLE "pm"."wizard_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2.2.1 Guard triggers -----------------------------------------------------------------------------
-- KP101 a build is never a subtask; KP103 a task never changes kind; KP104 a build moves between
-- containers only through the domain (`moveBuild` sets pm.build_move = 'on' for its transaction).
CREATE OR REPLACE FUNCTION "pm"."guard_task_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'task_kind_is_fixed' USING ERRCODE = 'KP103';
  END IF;
  IF NEW.kind = 'build' AND NEW.parent_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'build_is_top_level' USING ERRCODE = 'KP101';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind = 'build' AND NEW.project_id IS DISTINCT FROM OLD.project_id
     AND coalesce(current_setting('pm.build_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'build_move_needs_domain' USING ERRCODE = 'KP104';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tasks_guard_kind" ON "pm"."tasks";
--> statement-breakpoint
CREATE TRIGGER "tasks_guard_kind" BEFORE INSERT OR UPDATE OF "project_id","kind","parent_task_id" ON "pm"."tasks" FOR EACH ROW EXECUTE FUNCTION "pm"."guard_task_kind"();
--> statement-breakpoint
-- KP102 a project never becomes a program (and back).
CREATE OR REPLACE FUNCTION "pm"."guard_project_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'project_kind_is_fixed' USING ERRCODE = 'KP102';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "projects_guard_kind" ON "pm"."projects";
--> statement-breakpoint
CREATE TRIGGER "projects_guard_kind" BEFORE UPDATE OF "kind" ON "pm"."projects" FOR EACH ROW EXECUTE FUNCTION "pm"."guard_project_kind"();
--> statement-breakpoint
-- KP105 pm.builds matches its task (checked at commit, so moveBuild may update either row first):
-- a build task has its builds row, the builds row belongs to a build task, the container is the
-- task's project, program_id is the container when it is a program (else null), and the variant
-- belongs to that program.
CREATE OR REPLACE FUNCTION "pm"."check_build_match"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid uuid;
  t record; b record; pkind text; vprog uuid;
BEGIN
  IF TG_TABLE_NAME = 'builds' THEN tid := NEW.task_id; ELSE tid := NEW.id; END IF;
  SELECT id, kind, project_id INTO t FROM pm.tasks WHERE id = tid;
  SELECT * INTO b FROM pm.builds WHERE task_id = tid;
  IF t.kind = 'build' AND b.task_id IS NULL THEN RAISE EXCEPTION 'build_row_missing' USING ERRCODE = 'KP105'; END IF;
  IF b.task_id IS NULL THEN RETURN NULL; END IF;
  IF t.kind IS DISTINCT FROM 'build' THEN RAISE EXCEPTION 'build_task_kind' USING ERRCODE = 'KP105'; END IF;
  SELECT kind INTO pkind FROM pm.projects WHERE id = t.project_id;
  IF b.container_id <> t.project_id
     OR (pkind = 'program' AND b.program_id IS DISTINCT FROM t.project_id)
     OR (pkind = 'project' AND b.program_id IS NOT NULL) THEN
    RAISE EXCEPTION 'build_container_mismatch' USING ERRCODE = 'KP105';
  END IF;
  IF b.variant_id IS NOT NULL THEN
    SELECT program_id INTO vprog FROM pm.program_variants WHERE id = b.variant_id;
    IF vprog IS DISTINCT FROM b.program_id THEN RAISE EXCEPTION 'variant_of_other_program' USING ERRCODE = 'KP105'; END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "builds_match_task" ON "pm"."builds";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "builds_match_task" AFTER INSERT OR UPDATE ON "pm"."builds" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pm"."check_build_match"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tasks_match_build" ON "pm"."tasks";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tasks_match_build" AFTER INSERT OR UPDATE OF "project_id","kind" ON "pm"."tasks" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind = 'build') EXECUTE FUNCTION "pm"."check_build_match"();
--> statement-breakpoint
-- finished_on follows the task status on every status path (task updates, bulk edits, board drags,
-- status category changes and status deletes). first_finished_on keeps the first finish day.
CREATE OR REPLACE FUNCTION "pm"."sync_build_finish"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; tz text; today date;
BEGIN
  SELECT s.category INTO cat FROM pm.statuses s WHERE s.id = NEW.status_id;
  SELECT coalesce(ps.timezone, oc.timezone, 'America/Chicago') INTO tz
    FROM pm.builds b LEFT JOIN pm.program_settings ps ON ps.program_id = b.program_id
    LEFT JOIN pm.org_calendar oc ON oc.org_id = b.org_id WHERE b.task_id = NEW.id;
  today := (now() AT TIME ZONE tz)::date;
  IF cat = 'done' THEN
    UPDATE pm.builds SET first_finished_on = coalesce(first_finished_on, today),
                         finished_on = coalesce(finished_on, first_finished_on, today), updated_at = now(),
                         version = version + 1
     WHERE task_id = NEW.id AND finished_on IS NULL;
  ELSE
    UPDATE pm.builds SET finished_on = NULL, updated_at = now(), version = version + 1
     WHERE task_id = NEW.id AND finished_on IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tasks_sync_build_finish" ON "pm"."tasks";
--> statement-breakpoint
CREATE TRIGGER "tasks_sync_build_finish" AFTER UPDATE OF "status_id","completed_at" ON "pm"."tasks" FOR EACH ROW WHEN (NEW.kind = 'build') EXECUTE FUNCTION "pm"."sync_build_finish"();
--> statement-breakpoint
-- A builds row inserted for a task that is already done (an unplanned row marked done, an import)
-- starts finished, so the status and finished_on agree from the first moment.
CREATE OR REPLACE FUNCTION "pm"."init_build_finish"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; tz text; today date;
BEGIN
  IF NEW.finished_on IS NOT NULL THEN RETURN NEW; END IF;
  SELECT s.category INTO cat FROM pm.tasks t JOIN pm.statuses s ON s.id = t.status_id WHERE t.id = NEW.task_id;
  IF cat IS DISTINCT FROM 'done' THEN RETURN NEW; END IF;
  SELECT coalesce((SELECT ps.timezone FROM pm.program_settings ps WHERE ps.program_id = NEW.program_id),
                  (SELECT oc.timezone FROM pm.org_calendar oc WHERE oc.org_id = NEW.org_id),
                  'America/Chicago') INTO tz;
  today := (now() AT TIME ZONE tz)::date;
  NEW.first_finished_on := coalesce(NEW.first_finished_on, today);
  NEW.finished_on := NEW.first_finished_on;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "builds_init_finish" ON "pm"."builds";
--> statement-breakpoint
CREATE TRIGGER "builds_init_finish" BEFORE INSERT ON "pm"."builds" FOR EACH ROW EXECUTE FUNCTION "pm"."init_build_finish"();
