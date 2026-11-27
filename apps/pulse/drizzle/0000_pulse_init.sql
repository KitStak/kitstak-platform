-- KitStak Pulse: the `pulse` schema. Hand-written (never drizzle-kit push); mirrored for types in
-- apps/pulse/src/server/db/schema/*.ts. See docs/pulse/SPEC.md section 5.
-- Conventions: uuid PKs, timestamptz, org scoped rows (FK core.organization ON DELETE CASCADE),
-- enums as text + CHECK, money as bigint cents, per unit prices numeric(14,4), quantities numeric(14,3),
-- hours numeric(10,2). Every table has UNIQUE (org_id, id) and every pulse to pulse FK is the
-- composite (org_id, x_id), so a row can never point at another org's parent.
-- The shared columns (soft delete, version, stream columns), the composite FKs, the closed month
-- triggers and RLS are added by the DO blocks at the end, from one list each.
CREATE SCHEMA IF NOT EXISTS "pulse";
--> statement-breakpoint
-- Pulse migrates last. Projects 0000 narrows this CHECK to three values on a fresh database.
DO $$
BEGIN
  IF to_regclass('core.entitlements') IS NOT NULL THEN
    ALTER TABLE "core"."entitlements" DROP CONSTRAINT IF EXISTS "entitlements_module_check";
    ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_module_check"
      CHECK ("module" IN ('crm', 'wms', 'projects', 'pulse'));
  END IF;
END $$;
--> statement-breakpoint
-- 5.1 Setup tables ---------------------------------------------------------------------------
CREATE TABLE "pulse"."settings" (
  "org_id"                          uuid PRIMARY KEY REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "currency"                        text NOT NULL DEFAULT 'USD',
  "timezone"                        text NOT NULL DEFAULT 'America/Chicago',
  "week_start"                      smallint NOT NULL DEFAULT 1 CHECK ("week_start" BETWEEN 0 AND 6),
  "fiscal_year_start_month"         smallint NOT NULL DEFAULT 1 CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12),
  "working_days"                    smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  "default_shift_hours"             numeric(4,2) NOT NULL DEFAULT 8 CHECK ("default_shift_hours" > 0 AND "default_shift_hours" <= 24),
  "default_payroll_tax_bp"          int NOT NULL DEFAULT 900 CHECK ("default_payroll_tax_bp" BETWEEN 0 AND 100000),
  "default_benefits_bp"             int NOT NULL DEFAULT 1200 CHECK ("default_benefits_bp" BETWEEN 0 AND 100000),
  "default_other_burden_bp"         int NOT NULL DEFAULT 0 CHECK ("default_other_burden_bp" BETWEEN 0 AND 100000),
  "default_overhead_per_hour_cents" int NOT NULL DEFAULT 0 CHECK ("default_overhead_per_hour_cents" BETWEEN 0 AND 10000000),
  "default_overtime_multiplier"     numeric(3,2) NOT NULL DEFAULT 1.50 CHECK ("default_overtime_multiplier" >= 1 AND "default_overtime_multiplier" <= 5),
  "default_loaded_rate_cents"       int CHECK ("default_loaded_rate_cents" IS NULL OR "default_loaded_rate_cents" BETWEEN 0 AND 10000000),
  "default_target_margin_bp"        int NOT NULL DEFAULT 3000,
  "margin_floor_bp"                 int NOT NULL DEFAULT 1000,
  "at_risk_gap_bp"                  int NOT NULL DEFAULT 1000,
  "labor_watch_over_bp"             int NOT NULL DEFAULT 500,
  "labor_risk_over_bp"              int NOT NULL DEFAULT 1500,
  "productivity_watch_bp"           int NOT NULL DEFAULT 9500,
  "productivity_risk_bp"            int NOT NULL DEFAULT 8000,
  "material_watch_over_bp"          int NOT NULL DEFAULT 500,
  "no_entry_days"                   smallint NOT NULL DEFAULT 3 CHECK ("no_entry_days" BETWEEN 1 AND 60),
  "unbilled_alert_cents"            bigint NOT NULL DEFAULT 500000,
  "unbilled_alert_days"             smallint NOT NULL DEFAULT 14,
  "shared_cost_rule"                text NOT NULL DEFAULT 'by_labor_hours' CHECK ("shared_cost_rule" IN ('none', 'by_labor_hours', 'full', 'percent_of_labor')),
  "shared_pct_bp"                   int NOT NULL DEFAULT 0 CHECK ("shared_pct_bp" BETWEEN 0 AND 100000),
  "shared_spread"                   text NOT NULL DEFAULT 'week' CHECK ("shared_spread" IN ('day', 'week', 'month')),
  "default_parts_owner"             text NOT NULL DEFAULT 'us' CHECK ("default_parts_owner" IN ('us', 'client')),
  "default_member_role"             text NOT NULL DEFAULT 'none' CHECK ("default_member_role" IN ('manager', 'supervisor', 'viewer', 'none')),
  "job_number_prefix"               text NOT NULL DEFAULT 'J-',
  "job_seq"                         int NOT NULL DEFAULT 1000,
  "date_order"                      text NOT NULL DEFAULT 'MDY' CHECK ("date_order" IN ('MDY', 'DMY')),
  "wms_auto_create_jobs"            boolean NOT NULL DEFAULT true,
  "wms_sync_materials"              boolean NOT NULL DEFAULT true,
  "wms_sync_vas"                    boolean NOT NULL DEFAULT true,
  "wms_sync_billing"                boolean NOT NULL DEFAULT true,
  "wms_billing_ops_in_profit"       text[] NOT NULL DEFAULT '{}',
  "crm_suggest_jobs"                boolean NOT NULL DEFAULT true,
  "projects_time_import"            boolean NOT NULL DEFAULT true,
  "recalc_started_at"               timestamptz,
  "onboarding"                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sample_loaded_at"                timestamptz,
  "created_at"                      timestamptz NOT NULL DEFAULT now(),
  "updated_at"                      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."member_roles" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"        uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "role"           text NOT NULL CHECK ("role" IN ('owner', 'admin', 'manager', 'supervisor', 'viewer', 'none')),
  "sees_money"     boolean NOT NULL DEFAULT false,
  "kiosk_pin_hash" text,
  "updated_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "member_roles_org_user_key" UNIQUE ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "pulse"."sites" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"               text NOT NULL,
  "name"               text NOT NULL,
  "timezone"           text NOT NULL,
  "is_default"         boolean NOT NULL DEFAULT false,
  "wms_warehouse_id"   text,
  "last_rollover_date" date,
  "archived_at"        timestamptz,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."clients" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"                text NOT NULL,
  "name"                text NOT NULL,
  "status"              text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
  "contact_name"        text,
  "contact_email"       text,
  "phone"               text,
  "target_margin_bp"    int,
  "payment_terms_days"  int CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" BETWEEN 0 AND 3650),
  "parts_owner"         text CHECK ("parts_owner" IN ('us', 'client')),
  "notes"               text,
  "color"               text,
  "core_customer_id"    uuid REFERENCES "core"."customers"("id") ON DELETE SET NULL,
  "crm_account_item_id" uuid,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."labor_classes" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"        text NOT NULL,
  "name"        text NOT NULL,
  "kind"        text NOT NULL DEFAULT 'employee' CHECK ("kind" IN ('employee', 'temp_agency')),
  "is_default"  boolean NOT NULL DEFAULT false,
  "color"       text,
  "archived_at" timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."job_types" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"                   text NOT NULL,
  "name"                   text NOT NULL,
  "unit_label"             text NOT NULL DEFAULT 'units',
  "default_pricing_model"  text NOT NULL DEFAULT 'per_unit' CHECK ("default_pricing_model" IN ('per_unit', 'fixed', 'hourly')),
  "default_labor_class_id" uuid,
  "default_standard_uph"   numeric(12,3) CHECK ("default_standard_uph" IS NULL OR "default_standard_uph" > 0),
  "target_margin_bp"       int,
  "color"                  text,
  "icon"                   text,
  "position"               int NOT NULL DEFAULT 0,
  "is_builtin"             boolean NOT NULL DEFAULT false,
  "archived_at"            timestamptz,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."labor_rates" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                  uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "labor_class_id"          uuid NOT NULL,
  "site_id"                 uuid,
  "effective_from"          date NOT NULL,
  "wage_cents"              int NOT NULL CHECK ("wage_cents" BETWEEN 0 AND 10000000),
  "payroll_tax_bp"          int NOT NULL CHECK ("payroll_tax_bp" BETWEEN 0 AND 100000),
  "benefits_bp"             int NOT NULL CHECK ("benefits_bp" BETWEEN 0 AND 100000),
  "other_burden_bp"         int NOT NULL CHECK ("other_burden_bp" BETWEEN 0 AND 100000),
  "overhead_per_hour_cents" int NOT NULL CHECK ("overhead_per_hour_cents" BETWEEN 0 AND 10000000),
  "overtime_multiplier"     numeric(3,2) NOT NULL CHECK ("overtime_multiplier" >= 1 AND "overtime_multiplier" <= 5),
  "loaded_rate_cents"       int NOT NULL CHECK ("loaded_rate_cents" >= 0),
  "overtime_rate_cents"     int NOT NULL CHECK ("overtime_rate_cents" >= 0),
  "bill_rate_cents"         int CHECK ("bill_rate_cents" IS NULL OR "bill_rate_cents" BETWEEN 0 AND 10000000),
  "note"                    text,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."items" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "sku"             text NOT NULL,
  "name"            text NOT NULL,
  "uom"             text NOT NULL DEFAULT 'each',
  "unit_cost"       numeric(14,4) NOT NULL DEFAULT 0 CHECK ("unit_cost" >= 0 AND "unit_cost" < 1000000),
  "cost_updated_at" timestamptz,
  "supplied_by"     text CHECK ("supplied_by" IN ('us', 'client')),
  "client_id"       uuid,
  "core_item_id"    uuid,
  "wms_product_id"  text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."vas_services" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"                   text NOT NULL,
  "name"                   text NOT NULL,
  "unit_label"             text NOT NULL DEFAULT 'units',
  "billing"                text NOT NULL DEFAULT 'per_unit' CHECK ("billing" IN ('per_unit', 'per_hour', 'flat')),
  "default_price"          numeric(14,4) CHECK ("default_price" IS NULL OR ("default_price" >= 0 AND "default_price" < 1000000)),
  "default_cost_per_unit"  numeric(14,4) CHECK ("default_cost_per_unit" IS NULL OR ("default_cost_per_unit" >= 0 AND "default_cost_per_unit" < 1000000)),
  "standard_uph"           numeric(12,3) CHECK ("standard_uph" IS NULL OR "standard_uph" > 0),
  "default_labor_class_id" uuid,
  "wms_vas_type_id"        text,
  "color"                  text,
  "active"                 boolean NOT NULL DEFAULT true,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."standards" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "job_type_id"          uuid,
  "client_id"            uuid,
  "vas_service_id"       uuid,
  "labor_class_id"       uuid,
  "units_per_labor_hour" numeric(12,3) NOT NULL CHECK ("units_per_labor_hour" > 0),
  "effective_from"       date NOT NULL,
  "basis"                text NOT NULL DEFAULT 'typed' CHECK ("basis" IN ('typed', 'history', 'time_study')),
  "note"                 text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "standards_one_scope_check" CHECK (("job_type_id" IS NOT NULL) <> ("vas_service_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pulse"."targets" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "scope"        text NOT NULL CHECK ("scope" IN ('org', 'site', 'client', 'job_type', 'vas_service')),
  "scope_id"     uuid,
  "metric"       text NOT NULL CHECK ("metric" IN ('margin_pct', 'profit', 'revenue', 'units_per_labor_hour', 'labor_pct_of_revenue', 'cost_per_unit', 'utilization_pct')),
  "period_month" date CHECK ("period_month" IS NULL OR EXTRACT(DAY FROM "period_month") = 1),
  "value"        numeric(16,4) NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "targets_scope_id_check" CHECK (("scope" = 'org') = ("scope_id" IS NULL))
);
--> statement-breakpoint
-- 5.2 Jobs and plans -------------------------------------------------------------------------
CREATE TABLE "pulse"."jobs" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"                 text NOT NULL,
  "name"                   text NOT NULL,
  "client_id"              uuid NOT NULL,
  "job_type_id"            uuid NOT NULL,
  "site_id"                uuid NOT NULL,
  "kind"                   text NOT NULL DEFAULT 'one_time' CHECK ("kind" IN ('one_time', 'ongoing')),
  "status"                 text NOT NULL DEFAULT 'planned' CHECK ("status" IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  "pricing_model"          text NOT NULL DEFAULT 'per_unit' CHECK ("pricing_model" IN ('per_unit', 'fixed', 'hourly')),
  "unit_label"             text NOT NULL DEFAULT 'units',
  "planned_units"          numeric(14,3) NOT NULL DEFAULT 0 CHECK ("planned_units" >= 0 AND "planned_units" < 100000000),
  "unit_price"             numeric(14,4) CHECK ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000)),
  "fixed_price_cents"      bigint CHECK ("fixed_price_cents" IS NULL OR "fixed_price_cents" BETWEEN 0 AND 10000000000000),
  "bill_rate_cents"        int CHECK ("bill_rate_cents" IS NULL OR "bill_rate_cents" BETWEEN 0 AND 10000000),
  "material_method"        text NOT NULL DEFAULT 'standard' CHECK ("material_method" IN ('standard', 'actual')),
  "material_cost_per_unit" numeric(14,4) NOT NULL DEFAULT 0 CHECK ("material_cost_per_unit" >= 0 AND "material_cost_per_unit" < 1000000),
  "parts_owner"            text CHECK ("parts_owner" IN ('us', 'client')),
  "default_labor_class_id" uuid,
  "usual_crew"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  "standard_uph"           numeric(12,3) CHECK ("standard_uph" IS NULL OR "standard_uph" > 0),
  "target_margin_bp"       int,
  "start_date"             date,
  "due_date"               date,
  "completed_date"         date,
  "activated_at"           timestamptz,
  "po_number"              text,
  "owner_id"               uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "description"            text,
  "kit_sku"                text,
  "kit_name"               text,
  "wms_shortage"           boolean NOT NULL DEFAULT false,
  "pinned_note"            text,
  "archived_at"            timestamptz,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."job_prices" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "job_id"                 uuid NOT NULL,
  "effective_from"         date NOT NULL,
  "unit_price"             numeric(14,4) CHECK ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000)),
  "bill_rate_cents"        int CHECK ("bill_rate_cents" IS NULL OR "bill_rate_cents" BETWEEN 0 AND 10000000),
  "material_cost_per_unit" numeric(14,4) NOT NULL DEFAULT 0 CHECK ("material_cost_per_unit" >= 0 AND "material_cost_per_unit" < 1000000),
  "note"                   text,
  "created_by"             uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "job_prices_job_from_key" UNIQUE ("job_id", "effective_from")
);
--> statement-breakpoint
CREATE TABLE "pulse"."job_plans" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "job_id"         uuid NOT NULL,
  "plan"           text NOT NULL CHECK ("plan" IN ('quote', 'budget')),
  "units"          numeric(14,3) NOT NULL DEFAULT 0 CHECK ("units" >= 0 AND "units" < 100000000),
  "revenue_cents"  bigint NOT NULL DEFAULT 0,
  "labor_hours"    numeric(10,2) NOT NULL DEFAULT 0 CHECK ("labor_hours" >= 0),
  "labor_cents"    bigint NOT NULL DEFAULT 0,
  "setup_hours"    numeric(10,2) NOT NULL DEFAULT 0 CHECK ("setup_hours" >= 0),
  "setup_cents"    bigint NOT NULL DEFAULT 0,
  "material_cents" bigint NOT NULL DEFAULT 0,
  "other_cents"    bigint NOT NULL DEFAULT 0,
  "shared_cents"   bigint NOT NULL DEFAULT 0,
  "shared_auto"    boolean NOT NULL DEFAULT true,
  "version"        int NOT NULL DEFAULT 1,
  "origin"         text NOT NULL DEFAULT 'typed' CHECK ("origin" IN ('typed', 'csv', 'calculator', 'crm_deal', 'wms_contract', 'copied_from_quote', 'sample')),
  "origin_ref"     text,
  "note"           text,
  "locked_at"      timestamptz,
  "updated_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "job_plans_job_plan_key" UNIQUE ("job_id", "plan")
);
--> statement-breakpoint
CREATE TABLE "pulse"."job_plan_lines" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "plan_id"        uuid NOT NULL,
  "job_id"         uuid NOT NULL,
  "position"       int NOT NULL DEFAULT 0,
  "category"       text NOT NULL CHECK ("category" IN ('revenue', 'labor', 'setup', 'material', 'other')),
  "description"    text,
  "quantity"       numeric(14,3) CHECK ("quantity" IS NULL OR ("quantity" >= 0 AND "quantity" < 100000000)),
  "unit"           text CHECK ("unit" IN ('unit', 'hour', 'each', 'flat')),
  "unit_amount"    numeric(14,4),
  "amount_cents"   bigint NOT NULL,
  "flex"           boolean,
  "labor_class_id" uuid,
  "vas_service_id" uuid,
  "item_id"        uuid,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."job_links" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "job_id"        uuid NOT NULL,
  "target_type"   text NOT NULL CHECK ("target_type" IN ('crm_deal', 'crm_account', 'wms_work_order', 'wms_shipment_order', 'wms_client', 'pm_project', 'pm_task')),
  "target_id"     text NOT NULL,
  "imports_time"  boolean NOT NULL DEFAULT false,
  "cached_title"  text,
  "cached_status" text,
  "cached_url"    text CHECK ("cached_url" IS NULL OR ("cached_url" LIKE '/%' AND "cached_url" NOT LIKE '//%')),
  "cached_at"     timestamptz,
  "meta"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "job_links_job_target_key" UNIQUE ("job_id", "target_type", "target_id")
);
--> statement-breakpoint
CREATE TABLE "pulse"."job_stats" (
  "job_id"                  uuid PRIMARY KEY,
  "org_id"                  uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "units_good"              numeric(16,3) NOT NULL DEFAULT 0,
  "units_scrap"             numeric(16,3) NOT NULL DEFAULT 0,
  "units_rework"            numeric(16,3) NOT NULL DEFAULT 0,
  "hours"                   numeric(12,2) NOT NULL DEFAULT 0,
  "overtime_hours"          numeric(12,2) NOT NULL DEFAULT 0,
  "setup_hours"             numeric(12,2) NOT NULL DEFAULT 0,
  "pace_hours"              numeric(12,2) NOT NULL DEFAULT 0,
  "evidence_days"           int NOT NULL DEFAULT 0,
  "revenue_cents"           bigint NOT NULL DEFAULT 0,
  "base_revenue_cents"      bigint NOT NULL DEFAULT 0,
  "vas_revenue_cents"       bigint NOT NULL DEFAULT 0,
  "other_revenue_cents"     bigint NOT NULL DEFAULT 0,
  "billed_cents"            bigint NOT NULL DEFAULT 0,
  "labor_cents"             bigint NOT NULL DEFAULT 0,
  "material_cents"          bigint NOT NULL DEFAULT 0,
  "scrap_cents"             bigint NOT NULL DEFAULT 0,
  "other_cents"             bigint NOT NULL DEFAULT 0,
  "shared_cents"            bigint NOT NULL DEFAULT 0,
  "cost_cents"              bigint NOT NULL DEFAULT 0,
  "profit_cents"            bigint NOT NULL DEFAULT 0,
  "margin_bp"               int,
  "margin_before_shared_bp" int,
  "uph"                     numeric(12,3),
  "standard_uph"            numeric(12,3),
  "productivity_bp"         int,
  "pct_complete_bp"         int,
  "target_margin_bp"        int,
  "mode"                    text CHECK ("mode" IN ('projected', 'actuals', 'final')),
  "cost_at_finish_cents"    bigint,
  "revenue_at_finish_cents" bigint,
  "projected_profit_cents"  bigint,
  "projected_margin_bp"     int,
  "projected_labor_hours"   numeric(12,2),
  "projected_finish_date"   date,
  "pace_uph"                numeric(12,3),
  "pace_weight_bp"          int,
  "confidence"              text CHECK ("confidence" IN ('plan', 'early', 'good', 'solid')),
  "risk_status"             text CHECK ("risk_status" IN ('on_track', 'heads_up', 'at_risk', 'losing', 'no_data')),
  "risk_reasons"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "needs"                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "first_entry_date"        date,
  "last_entry_date"         date,
  "entry_count"             int NOT NULL DEFAULT 0,
  "computed_at"             timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- 5.3 Data streams ---------------------------------------------------------------------------
CREATE TABLE "pulse"."production_entries" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"             uuid NOT NULL,
  "job_id"              uuid NOT NULL,
  "work_date"           date NOT NULL,
  "shift"               text NOT NULL DEFAULT 'day',
  "labor_class_id"      uuid,
  "units_good"          numeric(14,3) NOT NULL DEFAULT 0 CHECK ("units_good" >= 0 AND "units_good" < 100000000),
  "units_scrap"         numeric(14,3) NOT NULL DEFAULT 0 CHECK ("units_scrap" >= 0 AND "units_scrap" < 100000000),
  "units_rework"        numeric(14,3) NOT NULL DEFAULT 0 CHECK ("units_rework" >= 0 AND "units_rework" < 100000000),
  "headcount"           numeric(6,2) CHECK ("headcount" IS NULL OR "headcount" >= 0),
  "hours"               numeric(10,2) NOT NULL DEFAULT 0 CHECK ("hours" >= 0),
  "overtime_hours"      numeric(10,2) NOT NULL DEFAULT 0 CHECK ("overtime_hours" >= 0),
  "setup_hours"         numeric(10,2) NOT NULL DEFAULT 0 CHECK ("setup_hours" >= 0),
  "hours_confirmed"     boolean NOT NULL DEFAULT true,
  "note"                text,
  "rate_cents"          int,
  "overtime_rate_cents" int,
  "labor_cost_cents"    bigint NOT NULL DEFAULT 0,
  "overhead_cents"      bigint NOT NULL DEFAULT 0,
  "gross_pay_cents"     bigint NOT NULL DEFAULT 0,
  "shared_cents"        bigint NOT NULL DEFAULT 0,
  "base_revenue_cents"  bigint NOT NULL DEFAULT 0,
  "std_material_cents"  bigint NOT NULL DEFAULT 0,
  "std_scrap_cents"     bigint NOT NULL DEFAULT 0,
  "needs_rate"          boolean NOT NULL DEFAULT false,
  "entered_by"          uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_entries_overtime_check" CHECK ("overtime_hours" <= "hours"),
  CONSTRAINT "production_entries_setup_check" CHECK ("setup_hours" <= "hours")
);
--> statement-breakpoint
CREATE TABLE "pulse"."indirect_entries" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"             uuid NOT NULL,
  "work_date"           date NOT NULL,
  "labor_class_id"      uuid,
  "reason"              text NOT NULL CHECK ("reason" IN ('meeting', 'training', 'cleanup', 'waiting', 'maintenance', 'break', 'other')),
  "headcount"           numeric(6,2) CHECK ("headcount" IS NULL OR "headcount" >= 0),
  "hours"               numeric(10,2) NOT NULL CHECK ("hours" >= 0),
  "overtime_hours"      numeric(10,2) NOT NULL DEFAULT 0 CHECK ("overtime_hours" >= 0),
  "note"                text,
  "rate_cents"          int,
  "overtime_rate_cents" int,
  "cost_cents"          bigint NOT NULL DEFAULT 0,
  "overhead_cents"      bigint NOT NULL DEFAULT 0,
  "gross_pay_cents"     bigint NOT NULL DEFAULT 0,
  "needs_rate"          boolean NOT NULL DEFAULT false,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "indirect_entries_overtime_check" CHECK ("overtime_hours" <= "hours")
);
--> statement-breakpoint
CREATE TABLE "pulse"."paid_hours" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"        uuid NOT NULL,
  "work_date"      date NOT NULL,
  "labor_class_id" uuid,
  "paid_hours"     numeric(10,2) NOT NULL CHECK ("paid_hours" >= 0),
  "paid_cents"     bigint CHECK ("paid_cents" IS NULL OR "paid_cents" BETWEEN 0 AND 10000000000000),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."time_punches" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"        uuid NOT NULL,
  "work_date"      date NOT NULL,
  "employee_code"  text NOT NULL,
  "employee_name"  text,
  "job_id"         uuid,
  "reason"         text CHECK ("reason" IN ('meeting', 'training', 'cleanup', 'waiting', 'maintenance', 'break', 'other')),
  "labor_class_id" uuid,
  "hours"          numeric(10,2) NOT NULL CHECK ("hours" >= 0),
  "overtime_hours" numeric(10,2) NOT NULL DEFAULT 0 CHECK ("overtime_hours" >= 0),
  "pay_cents"      bigint CHECK ("pay_cents" IS NULL OR "pay_cents" BETWEEN 0 AND 10000000000000),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "time_punches_overtime_check" CHECK ("overtime_hours" <= "hours"),
  CONSTRAINT "time_punches_job_or_reason_check" CHECK ("job_id" IS NULL OR "reason" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "pulse"."material_usage" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"              uuid NOT NULL,
  "job_id"               uuid NOT NULL,
  "usage_date"           date NOT NULL,
  "item_id"              uuid,
  "item_sku"             text,
  "item_name"            text,
  "quantity_used"        numeric(14,3) NOT NULL CHECK ("quantity_used" >= 0 AND "quantity_used" < 100000000),
  "quantity_scrapped"    numeric(14,3) NOT NULL DEFAULT 0 CHECK ("quantity_scrapped" >= 0 AND "quantity_scrapped" < 100000000),
  "quantity_planned"     numeric(14,3) CHECK ("quantity_planned" IS NULL OR ("quantity_planned" >= 0 AND "quantity_planned" < 100000000)),
  "unit_cost"            numeric(14,4) NOT NULL DEFAULT 0 CHECK ("unit_cost" >= 0 AND "unit_cost" < 1000000),
  "uom"                  text,
  "lot"                  text,
  "supplied_by"          text CHECK ("supplied_by" IN ('us', 'client')),
  "resolved_supplied_by" text NOT NULL DEFAULT 'us' CHECK ("resolved_supplied_by" IN ('us', 'client')),
  "note"                 text,
  "cost_cents"           bigint NOT NULL DEFAULT 0,
  "scrap_cents"          bigint NOT NULL DEFAULT 0,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."cost_entries" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"      uuid,
  "scope"        text NOT NULL CHECK ("scope" IN ('job', 'client', 'company')),
  "job_id"       uuid,
  "client_id"    uuid,
  "cost_date"    date NOT NULL,
  "category"     text NOT NULL CHECK ("category" IN ('freight', 'packaging', 'equipment', 'outside_service', 'rework', 'supplies', 'storage', 'rent', 'utilities', 'salaried_staff', 'insurance', 'other')),
  "amount_cents" bigint NOT NULL CHECK ("amount_cents" BETWEEN -10000000000000 AND 10000000000000),
  "vendor"       text,
  "reference"    text,
  "note"         text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cost_entries_scope_ids_check" CHECK (
    ("scope" = 'job' AND "job_id" IS NOT NULL AND "client_id" IS NOT NULL AND "site_id" IS NOT NULL)
    OR ("scope" = 'client' AND "job_id" IS NULL AND "client_id" IS NOT NULL AND "site_id" IS NOT NULL)
    OR ("scope" = 'company' AND "job_id" IS NULL AND "client_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "pulse"."revenue_entries" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"        uuid NOT NULL,
  "job_id"         uuid,
  "client_id"      uuid NOT NULL,
  "revenue_date"   date NOT NULL,
  "kind"           text NOT NULL CHECK ("kind" IN ('invoice', 'fee', 'adjustment', 'credit', 'fixed_true_up')),
  "description"    text,
  "quantity"       numeric(14,3) CHECK ("quantity" IS NULL OR ("quantity" >= 0 AND "quantity" < 100000000)),
  "unit_price"     numeric(14,4) CHECK ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000)),
  "amount_cents"   bigint NOT NULL CHECK ("amount_cents" BETWEEN -10000000000000 AND 10000000000000),
  "invoice_number" text,
  "vas_service_id" uuid,
  "service_label"  text,
  "approved"       boolean NOT NULL DEFAULT true,
  "note"           text,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."vas_entries" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"             uuid NOT NULL,
  "vas_service_id"      uuid NOT NULL,
  "client_id"           uuid NOT NULL,
  "job_id"              uuid,
  "work_date"           date NOT NULL,
  "quantity"            numeric(14,3) NOT NULL CHECK ("quantity" >= 0 AND "quantity" < 100000000),
  "unit_price"          numeric(14,4) CHECK ("unit_price" IS NULL OR ("unit_price" >= 0 AND "unit_price" < 1000000)),
  "amount_cents"        bigint CHECK ("amount_cents" IS NULL OR "amount_cents" BETWEEN -10000000000000 AND 10000000000000),
  "labor_class_id"      uuid,
  "headcount"           numeric(6,2) CHECK ("headcount" IS NULL OR "headcount" >= 0),
  "hours"               numeric(10,2) NOT NULL DEFAULT 0 CHECK ("hours" >= 0),
  "overtime_hours"      numeric(10,2) NOT NULL DEFAULT 0 CHECK ("overtime_hours" >= 0),
  "material_cents"      bigint NOT NULL DEFAULT 0 CHECK ("material_cents" BETWEEN 0 AND 10000000000000),
  "note"                text,
  "rate_cents"          int,
  "overtime_rate_cents" int,
  "labor_cost_cents"    bigint NOT NULL DEFAULT 0,
  "overhead_cents"      bigint NOT NULL DEFAULT 0,
  "gross_pay_cents"     bigint NOT NULL DEFAULT 0,
  "shared_cents"        bigint NOT NULL DEFAULT 0,
  "needs_rate"          boolean NOT NULL DEFAULT false,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "vas_entries_overtime_check" CHECK ("overtime_hours" <= "hours")
);
--> statement-breakpoint
-- Rollup tables --------------------------------------------------------------------------------
CREATE TABLE "pulse"."fact_days" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "work_date"      date NOT NULL,
  "site_id"        uuid NOT NULL,
  "client_id"      uuid NOT NULL,
  "job_id"         uuid,
  "job_type_id"    uuid,
  "vas_service_id" uuid,
  "kind"           text NOT NULL CHECK ("kind" IN ('revenue_base', 'revenue_vas', 'revenue_other', 'labor', 'material', 'other', 'shared', 'billed_memo')),
  "amount_cents"   bigint NOT NULL DEFAULT 0,
  "units_good"     numeric(16,3) NOT NULL DEFAULT 0,
  "units_scrap"    numeric(16,3) NOT NULL DEFAULT 0,
  "hours"          numeric(12,2) NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fact_days_key" ON "pulse"."fact_days"
  ("org_id", "work_date", "site_id", "client_id", COALESCE("job_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("vas_service_id", '00000000-0000-0000-0000-000000000000'::uuid), "kind");
--> statement-breakpoint
CREATE INDEX "fact_days_org_date_idx" ON "pulse"."fact_days" ("org_id", "work_date");
--> statement-breakpoint
CREATE INDEX "fact_days_org_job_date_idx" ON "pulse"."fact_days" ("org_id", "job_id", "work_date");
--> statement-breakpoint
CREATE INDEX "fact_days_org_client_date_idx" ON "pulse"."fact_days" ("org_id", "client_id", "work_date");
--> statement-breakpoint
CREATE TABLE "pulse"."company_days" (
  "org_id"                  uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"                 uuid NOT NULL,
  "work_date"               date NOT NULL,
  "direct_hours"            numeric(12,2) NOT NULL DEFAULT 0,
  "indirect_hours"          numeric(12,2) NOT NULL DEFAULT 0,
  "paid_hours"              numeric(12,2) NOT NULL DEFAULT 0,
  "missing_hours"           numeric(12,2) NOT NULL DEFAULT 0,
  "indirect_cents"          bigint NOT NULL DEFAULT 0,
  "shared_applied_cents"    bigint NOT NULL DEFAULT 0,
  "missing_cents"           bigint NOT NULL DEFAULT 0,
  "paid_cents"              bigint,
  "gross_pay_cents"         bigint NOT NULL DEFAULT 0,
  "company_cost_cents"      bigint NOT NULL DEFAULT 0,
  "overhead_absorbed_cents" bigint NOT NULL DEFAULT 0,
  "over_logged"             boolean NOT NULL DEFAULT false,
  CONSTRAINT "company_days_pkey" PRIMARY KEY ("org_id", "site_id", "work_date")
);
--> statement-breakpoint
-- 5.4 Control, workflow and system tables --------------------------------------------------------
CREATE TABLE "pulse"."periods" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "period_month"  date NOT NULL CHECK (EXTRACT(DAY FROM "period_month") = 1),
  "status"        text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'closed')),
  "closed_at"     timestamptz,
  "closed_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reopened_at"   timestamptz,
  "reopened_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reopen_reason" text,
  "snapshot"      jsonb,
  "checklist"     jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "periods_org_month_key" UNIQUE ("org_id", "period_month")
);
--> statement-breakpoint
CREATE INDEX "periods_closed_idx" ON "pulse"."periods" ("org_id", "period_month") WHERE "status" = 'closed';
--> statement-breakpoint
CREATE TABLE "pulse"."day_reviews" (
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"     uuid NOT NULL,
  "work_date"   date NOT NULL,
  "status"      text NOT NULL CHECK ("status" IN ('complete', 'approved', 'sent_back')),
  "flags"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "marked_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "marked_at"   timestamptz,
  "reviewed_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz,
  "note"        text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "day_reviews_pkey" PRIMARY KEY ("org_id", "site_id", "work_date")
);
--> statement-breakpoint
CREATE TABLE "pulse"."alert_rules" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"            text NOT NULL,
  "kind"            text NOT NULL CHECK ("kind" IN ('job_losing', 'job_at_risk', 'margin_below', 'labor_over_budget', 'material_over_budget', 'productivity_below',
                      'no_entry_days', 'due_soon_behind', 'missing_rate', 'missing_price', 'missing_hours', 'unbilled_above', 'client_margin_below', 'vas_margin_below',
                      'missing_time_above', 'overhead_rate_off', 'wms_shortage', 'deal_won_no_job', 'month_ready_to_close', 'import_failed', 'sync_failed')),
  "threshold"       numeric(16,4),
  "scope"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "severity"        text NOT NULL DEFAULT 'warning' CHECK ("severity" IN ('info', 'warning', 'critical')),
  "notify_roles"    text[] NOT NULL DEFAULT '{}',
  "notify_user_ids" uuid[] NOT NULL DEFAULT '{}',
  "enabled"         boolean NOT NULL DEFAULT true,
  "is_system"       boolean NOT NULL DEFAULT false,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pulse"."alerts" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "rule_id"       uuid,
  "kind"          text NOT NULL,
  "severity"      text NOT NULL DEFAULT 'warning' CHECK ("severity" IN ('info', 'warning', 'critical')),
  "entity_type"   text NOT NULL CHECK ("entity_type" IN ('job', 'client', 'vas_service', 'site', 'period', 'import', 'sync', 'deal')),
  "entity_id"     text,
  "params"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "impact_cents"  bigint,
  "url"           text CHECK ("url" IS NULL OR ("url" LIKE '/%' AND "url" NOT LIKE '//%')),
  "status"        text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'snoozed', 'resolved', 'dismissed')),
  "snoozed_until" date,
  "assigned_to"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "resolved_at"   timestamptz,
  "resolved_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "resolution"    text CHECK ("resolution" IN ('cleared', 'manual')),
  "dedupe_key"    text NOT NULL,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at"  timestamptz NOT NULL DEFAULT now(),
  "pm_task_id"    uuid,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_live_key" ON "pulse"."alerts" ("org_id", "dedupe_key") WHERE "status" IN ('open', 'snoozed');
--> statement-breakpoint
CREATE INDEX "alerts_org_status_idx" ON "pulse"."alerts" ("org_id", "status", "severity");
--> statement-breakpoint
CREATE INDEX "alerts_org_entity_idx" ON "pulse"."alerts" ("org_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE "pulse"."notifications" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"     uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "kind"        text NOT NULL,
  "params"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "url"         text CHECK ("url" IS NULL OR ("url" LIKE '/%' AND "url" NOT LIKE '//%')),
  "alert_id"    uuid,
  "job_id"      uuid,
  "read_at"     timestamptz,
  "archived_at" timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "pulse"."notifications" ("org_id", "user_id", "read_at");
--> statement-breakpoint
CREATE TABLE "pulse"."import_batches" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "stream"          text NOT NULL,
  "file_name"       text,
  "file_size"       int,
  "file_hash"       text,
  "delimiter"       text,
  "header"          jsonb,
  "mapping"         jsonb,
  "options"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"          text NOT NULL DEFAULT 'uploading' CHECK ("status" IN ('uploading', 'mapped', 'checked', 'committed', 'failed', 'undone')),
  "total_rows"      int NOT NULL DEFAULT 0,
  "create_count"    int NOT NULL DEFAULT 0,
  "update_count"    int NOT NULL DEFAULT 0,
  "unchanged_count" int NOT NULL DEFAULT 0,
  "skip_count"      int NOT NULL DEFAULT 0,
  "error_count"     int NOT NULL DEFAULT 0,
  "warning_count"   int NOT NULL DEFAULT 0,
  "committed_at"    timestamptz,
  "undone_at"       timestamptz,
  "undo_until"      timestamptz,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "import_batches_org_created_idx" ON "pulse"."import_batches" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "import_batches_hash_idx" ON "pulse"."import_batches" ("org_id", "stream", "file_hash");
--> statement-breakpoint
CREATE TABLE "pulse"."import_rows" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "batch_id"   uuid NOT NULL,
  "row_number" int NOT NULL,
  "raw"        jsonb,
  "parsed"     jsonb,
  "action"     text CHECK ("action" IN ('create', 'update', 'unchanged', 'skip', 'lookalike', 'error')),
  "messages"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "entity_id"  uuid,
  "before"     jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "import_rows_batch_row_idx" ON "pulse"."import_rows" ("batch_id", "row_number");
--> statement-breakpoint
CREATE INDEX "import_rows_batch_action_idx" ON "pulse"."import_rows" ("batch_id", "action");
--> statement-breakpoint
CREATE TABLE "pulse"."import_presets" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "stream"           text NOT NULL,
  "name"             text NOT NULL,
  "header_signature" text,
  "mapping"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "options"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_used_at"     timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "import_presets_org_stream_name_key" UNIQUE ("org_id", "stream", "name")
);
--> statement-breakpoint
CREATE TABLE "pulse"."saved_views" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "page"       text NOT NULL CHECK ("page" IN ('jobs', 'profit', 'log', 'labor', 'reports', 'alerts')),
  "name"       text NOT NULL,
  "config"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "shared"     boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "position"   int NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "saved_views_org_page_idx" ON "pulse"."saved_views" ("org_id", "page");
--> statement-breakpoint
CREATE TABLE "pulse"."activity" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "actor_id"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "actor_kind"  text NOT NULL DEFAULT 'user' CHECK ("actor_kind" IN ('user', 'system', 'integration', 'automation', 'device')),
  "verb"        text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id"   uuid,
  "job_id"      uuid,
  "client_id"   uuid,
  "field"       text,
  "before"      jsonb,
  "after"       jsonb,
  "meta"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "body"        text,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "activity_org_created_idx" ON "pulse"."activity" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "activity_org_job_created_idx" ON "pulse"."activity" ("org_id", "job_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "activity_org_entity_idx" ON "pulse"."activity" ("org_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE "pulse"."user_prefs" (
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "prefs"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "pulse"."quote_scenarios" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"             text NOT NULL,
  "client_id"        uuid,
  "job_type_id"      uuid,
  "job_id"           uuid,
  "inputs"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"           text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'sent', 'won', 'lost')),
  "crm_deal_item_id" uuid,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "quote_scenarios_deal_idx" ON "pulse"."quote_scenarios" ("org_id", "crm_deal_item_id");
--> statement-breakpoint
CREATE TABLE "pulse"."report_schedules" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"               text NOT NULL,
  "report"             text NOT NULL,
  "config"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cadence"            text NOT NULL CHECK ("cadence" IN ('daily', 'weekly', 'monthly')),
  "weekday"            smallint CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6),
  "day_of_month"       smallint CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 31),
  "hour"               smallint NOT NULL DEFAULT 7 CHECK ("hour" BETWEEN 0 AND 23),
  "recipient_user_ids" uuid[] NOT NULL DEFAULT '{}',
  "format"             text NOT NULL DEFAULT 'csv' CHECK ("format" IN ('csv', 'html', 'both')),
  "include_money"      boolean NOT NULL DEFAULT false,
  "enabled"            boolean NOT NULL DEFAULT true,
  "last_run_at"        timestamptz,
  "next_run_at"        timestamptz,
  "created_by"         uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "report_schedules_next_idx" ON "pulse"."report_schedules" ("next_run_at") WHERE "enabled";
--> statement-breakpoint
CREATE TABLE "pulse"."report_runs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "schedule_id"   uuid,
  "report"        text NOT NULL,
  "period_label"  text,
  "csv"           text CHECK ("csv" IS NULL OR octet_length("csv") <= 2097152),
  "html"          text CHECK ("html" IS NULL OR octet_length("html") <= 2097152),
  "row_count"     int NOT NULL DEFAULT 0,
  "include_money" boolean NOT NULL DEFAULT false,
  "status"        text NOT NULL DEFAULT 'ready' CHECK ("status" IN ('ready', 'failed')),
  "error"         text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "report_runs_org_created_idx" ON "pulse"."report_runs" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE "pulse"."device_links" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"         text NOT NULL CHECK ("kind" IN ('wall', 'kiosk')),
  "name"         text NOT NULL,
  "token_hash"   text NOT NULL UNIQUE,
  "token_prefix" text NOT NULL,
  "site_id"      uuid NOT NULL,
  "config"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at"   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  "last_seen_at" timestamptz,
  "revoked_at"   timestamptz,
  "created_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "device_links_prefix_idx" ON "pulse"."device_links" ("token_prefix");
--> statement-breakpoint
CREATE TABLE "pulse"."sync_state" (
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "source"       text NOT NULL CHECK ("source" IN ('wms', 'crm', 'projects')),
  "cursor"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "locked_until" timestamptz,
  "last_run_at"  timestamptz,
  "last_ok_at"   timestamptz,
  "last_status"  text,
  "last_error"   text,
  "counts"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sync_state_pkey" PRIMARY KEY ("org_id", "source")
);
--> statement-breakpoint
CREATE TABLE "pulse"."sync_runs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "source"         text NOT NULL CHECK ("source" IN ('wms', 'crm', 'projects')),
  "started_at"     timestamptz NOT NULL DEFAULT now(),
  "finished_at"    timestamptz,
  "status"         text NOT NULL DEFAULT 'running',
  "created"        int NOT NULL DEFAULT 0,
  "updated"        int NOT NULL DEFAULT 0,
  "skipped"        int NOT NULL DEFAULT 0,
  "skipped_closed" int NOT NULL DEFAULT 0,
  "error"          text,
  "trigger"        text NOT NULL DEFAULT 'manual' CHECK ("trigger" IN ('cron', 'manual', 'page', 'event')),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "sync_runs_org_source_idx" ON "pulse"."sync_runs" ("org_id", "source", "started_at" DESC);
--> statement-breakpoint
CREATE TABLE "pulse"."dismissals" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"       text NOT NULL,
  "target_id"  text NOT NULL,
  "user_id"    uuid REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dismissals_key" ON "pulse"."dismissals" ("org_id", "kind", "target_id", COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE TABLE "pulse"."bridge_events" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"         text NOT NULL CHECK ("kind" IN ('wms_work_order_changed', 'crm_deal_stage_changed', 'pm_time_logged')),
  "target_id"    text NOT NULL,
  "payload"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "claimed_at"   timestamptz,
  "attempts"     int NOT NULL DEFAULT 0,
  "last_error"   text,
  "processed_at" timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_events_pending_key" ON "pulse"."bridge_events" ("org_id", "kind", "target_id") WHERE "processed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "bridge_events_waiting_idx" ON "pulse"."bridge_events" ("org_id", "created_at") WHERE "processed_at" IS NULL;
--> statement-breakpoint
-- Shared columns -------------------------------------------------------------------------------
-- SD: soft delete. V: optimistic version. STREAM: where a row came from, so a sync or a
-- re-import is always an upsert on (org_id, source, source_ref).
DO $$
DECLARE
  t text;
  sd_tables text[] := ARRAY['production_entries','indirect_entries','paid_hours','time_punches','material_usage','cost_entries','revenue_entries','vas_entries',
    'clients','jobs','labor_rates','items','vas_services','standards','targets',
    'sites','job_types','labor_classes','alert_rules','saved_views','quote_scenarios','report_schedules','device_links'];
  stream_tables text[] := ARRAY['production_entries','indirect_entries','paid_hours','time_punches','material_usage','cost_entries','revenue_entries','vas_entries',
    'clients','jobs','labor_rates','items','vas_services','standards','targets'];
BEGIN
  FOREACH t IN ARRAY sd_tables LOOP
    EXECUTE format('ALTER TABLE "pulse".%I ADD COLUMN "deleted_at" timestamptz', t);
  END LOOP;
  FOREACH t IN ARRAY stream_tables LOOP
    EXECUTE format($f$ALTER TABLE "pulse".%I
      ADD COLUMN "version" int NOT NULL DEFAULT 1,
      ADD COLUMN "source" text NOT NULL DEFAULT 'manual' CHECK ("source" IN ('manual','csv','wms','crm','projects','punch','system','sample')),
      ADD COLUMN "source_ref" text,
      ADD COLUMN "import_batch_id" uuid,
      ADD COLUMN "is_sample" boolean NOT NULL DEFAULT false,
      ADD COLUMN "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
      ADD COLUMN "updated_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
      ADD COLUMN "meta" jsonb NOT NULL DEFAULT '{}'::jsonb$f$, t);
    EXECUTE format('CREATE UNIQUE INDEX %I ON "pulse".%I ("org_id", "source", "source_ref") WHERE "source_ref" IS NOT NULL AND "deleted_at" IS NULL', t || '_source_ref_key', t);
  END LOOP;
  -- No cross org pointers: every table with an id gets UNIQUE (org_id, id).
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'pulse' AND c.column_name = 'id' ORDER BY c.table_name LOOP
    EXECUTE format('ALTER TABLE "pulse".%I ADD CONSTRAINT %I UNIQUE ("org_id", "id")', t, t || '_org_id_id_key');
  END LOOP;
END $$;
--> statement-breakpoint
-- Composite foreign keys: child(org_id, column) references parent(org_id, id).
-- NO ACTION (checked at statement end) stands in for RESTRICT so an org cascade can remove
-- parents and children in one statement. 'c' rows cascade from their parent.
DO $$
DECLARE
  fk text[];
  fks text[][] := ARRAY[
    ['labor_rates','labor_class_id','labor_classes','n'], ['labor_rates','site_id','sites','n'],
    ['job_types','default_labor_class_id','labor_classes','n'],
    ['items','client_id','clients','n'],
    ['vas_services','default_labor_class_id','labor_classes','n'],
    ['standards','job_type_id','job_types','n'], ['standards','client_id','clients','n'], ['standards','vas_service_id','vas_services','n'], ['standards','labor_class_id','labor_classes','n'],
    ['jobs','client_id','clients','n'], ['jobs','job_type_id','job_types','n'], ['jobs','site_id','sites','n'], ['jobs','default_labor_class_id','labor_classes','n'],
    ['job_prices','job_id','jobs','c'], ['job_plans','job_id','jobs','c'], ['job_links','job_id','jobs','c'], ['job_stats','job_id','jobs','c'],
    ['job_plan_lines','plan_id','job_plans','c'], ['job_plan_lines','job_id','jobs','c'], ['job_plan_lines','labor_class_id','labor_classes','n'],
    ['job_plan_lines','vas_service_id','vas_services','n'], ['job_plan_lines','item_id','items','n'],
    ['production_entries','site_id','sites','n'], ['production_entries','job_id','jobs','n'], ['production_entries','labor_class_id','labor_classes','n'],
    ['indirect_entries','site_id','sites','n'], ['indirect_entries','labor_class_id','labor_classes','n'],
    ['paid_hours','site_id','sites','n'], ['paid_hours','labor_class_id','labor_classes','n'],
    ['time_punches','site_id','sites','n'], ['time_punches','job_id','jobs','n'], ['time_punches','labor_class_id','labor_classes','n'],
    ['material_usage','site_id','sites','n'], ['material_usage','job_id','jobs','n'], ['material_usage','item_id','items','n'],
    ['cost_entries','site_id','sites','n'], ['cost_entries','job_id','jobs','n'], ['cost_entries','client_id','clients','n'],
    ['revenue_entries','site_id','sites','n'], ['revenue_entries','job_id','jobs','n'], ['revenue_entries','client_id','clients','n'], ['revenue_entries','vas_service_id','vas_services','n'],
    ['vas_entries','site_id','sites','n'], ['vas_entries','vas_service_id','vas_services','n'], ['vas_entries','client_id','clients','n'], ['vas_entries','job_id','jobs','n'], ['vas_entries','labor_class_id','labor_classes','n'],
    ['fact_days','site_id','sites','c'], ['fact_days','client_id','clients','c'], ['fact_days','job_id','jobs','c'],
    ['company_days','site_id','sites','c'], ['day_reviews','site_id','sites','c'],
    ['alerts','rule_id','alert_rules','n'], ['notifications','alert_id','alerts','c'], ['notifications','job_id','jobs','c'],
    ['import_rows','batch_id','import_batches','c'],
    ['quote_scenarios','client_id','clients','n'], ['quote_scenarios','job_type_id','job_types','n'], ['quote_scenarios','job_id','jobs','n'],
    ['report_runs','schedule_id','report_schedules','c'],
    ['device_links','site_id','sites','n']
  ];
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fks LOOP
    EXECUTE format('ALTER TABLE "pulse".%I ADD CONSTRAINT %I FOREIGN KEY ("org_id", %I) REFERENCES "pulse".%I ("org_id", "id")%s',
      fk[1], fk[1] || '_' || fk[2] || '_fkey', fk[2], fk[3], CASE WHEN fk[4] = 'c' THEN ' ON DELETE CASCADE' ELSE '' END);
  END LOOP;
END $$;
--> statement-breakpoint
-- Unique keys and indexes that need the shared columns.
CREATE UNIQUE INDEX "sites_code_key" ON "pulse"."sites" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "sites_wms_key" ON "pulse"."sites" ("org_id", "wms_warehouse_id") WHERE "wms_warehouse_id" IS NOT NULL;
CREATE UNIQUE INDEX "sites_default_key" ON "pulse"."sites" ("org_id") WHERE "is_default" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "clients_code_key" ON "pulse"."clients" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "clients_core_customer_key" ON "pulse"."clients" ("org_id", "core_customer_id") WHERE "core_customer_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "clients_crm_account_key" ON "pulse"."clients" ("org_id", "crm_account_item_id") WHERE "crm_account_item_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "clients_name_idx" ON "pulse"."clients" ("org_id", lower("name"));
CREATE UNIQUE INDEX "job_types_code_key" ON "pulse"."job_types" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "labor_classes_code_key" ON "pulse"."labor_classes" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "labor_classes_default_key" ON "pulse"."labor_classes" ("org_id") WHERE "is_default" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "labor_rates_key" ON "pulse"."labor_rates" ("org_id", "labor_class_id", COALESCE("site_id", '00000000-0000-0000-0000-000000000000'::uuid), "effective_from") WHERE "deleted_at" IS NULL;
CREATE INDEX "labor_rates_class_idx" ON "pulse"."labor_rates" ("org_id", "labor_class_id", "effective_from" DESC);
CREATE UNIQUE INDEX "items_sku_key" ON "pulse"."items" ("org_id", lower("sku")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "items_wms_key" ON "pulse"."items" ("org_id", "wms_product_id") WHERE "wms_product_id" IS NOT NULL;
CREATE UNIQUE INDEX "items_core_key" ON "pulse"."items" ("org_id", "core_item_id") WHERE "core_item_id" IS NOT NULL;
CREATE UNIQUE INDEX "vas_services_code_key" ON "pulse"."vas_services" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "vas_services_wms_key" ON "pulse"."vas_services" ("org_id", "wms_vas_type_id") WHERE "wms_vas_type_id" IS NOT NULL;
CREATE INDEX "standards_lookup_idx" ON "pulse"."standards" ("org_id", "job_type_id", "client_id", "effective_from" DESC);
CREATE UNIQUE INDEX "targets_key" ON "pulse"."targets" ("org_id", "scope", COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid), "metric", COALESCE("period_month", '0001-01-01'::date)) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "jobs_number_key" ON "pulse"."jobs" ("org_id", lower("number")) WHERE "deleted_at" IS NULL;
CREATE INDEX "jobs_status_idx" ON "pulse"."jobs" ("org_id", "status");
CREATE INDEX "jobs_client_idx" ON "pulse"."jobs" ("org_id", "client_id");
CREATE INDEX "jobs_type_idx" ON "pulse"."jobs" ("org_id", "job_type_id");
CREATE INDEX "jobs_site_idx" ON "pulse"."jobs" ("org_id", "site_id");
CREATE INDEX "jobs_owner_idx" ON "pulse"."jobs" ("org_id", "owner_id");
CREATE INDEX "jobs_due_idx" ON "pulse"."jobs" ("org_id", "due_date");
CREATE INDEX "job_plan_lines_plan_idx" ON "pulse"."job_plan_lines" ("plan_id", "position");
CREATE UNIQUE INDEX "job_links_work_order_key" ON "pulse"."job_links" ("org_id", "target_id") WHERE "target_type" = 'wms_work_order';
CREATE UNIQUE INDEX "job_links_project_time_key" ON "pulse"."job_links" ("org_id", "target_id") WHERE "target_type" = 'pm_project' AND "imports_time";
CREATE INDEX "job_links_target_idx" ON "pulse"."job_links" ("org_id", "target_type", "target_id");
CREATE INDEX "job_stats_risk_idx" ON "pulse"."job_stats" ("org_id", "risk_status");
CREATE UNIQUE INDEX "production_entries_key" ON "pulse"."production_entries" ("org_id", "job_id", "work_date", "shift", COALESCE("labor_class_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "deleted_at" IS NULL;
CREATE INDEX "production_entries_date_idx" ON "pulse"."production_entries" ("org_id", "work_date");
CREATE INDEX "production_entries_job_date_idx" ON "pulse"."production_entries" ("org_id", "job_id", "work_date");
CREATE INDEX "production_entries_site_date_idx" ON "pulse"."production_entries" ("org_id", "site_id", "work_date");
CREATE INDEX "indirect_entries_site_date_idx" ON "pulse"."indirect_entries" ("org_id", "site_id", "work_date");
CREATE UNIQUE INDEX "paid_hours_key" ON "pulse"."paid_hours" ("org_id", "site_id", "work_date", COALESCE("labor_class_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "deleted_at" IS NULL;
CREATE INDEX "time_punches_site_date_idx" ON "pulse"."time_punches" ("org_id", "site_id", "work_date");
CREATE INDEX "time_punches_job_date_idx" ON "pulse"."time_punches" ("org_id", "job_id", "work_date");
CREATE INDEX "material_usage_job_date_idx" ON "pulse"."material_usage" ("org_id", "job_id", "usage_date");
CREATE INDEX "material_usage_date_idx" ON "pulse"."material_usage" ("org_id", "usage_date") WHERE "deleted_at" IS NULL;
CREATE INDEX "cost_entries_job_date_idx" ON "pulse"."cost_entries" ("org_id", "job_id", "cost_date");
CREATE INDEX "cost_entries_client_date_idx" ON "pulse"."cost_entries" ("org_id", "client_id", "cost_date");
CREATE INDEX "cost_entries_date_idx" ON "pulse"."cost_entries" ("org_id", "cost_date") WHERE "deleted_at" IS NULL;
CREATE INDEX "revenue_entries_job_date_idx" ON "pulse"."revenue_entries" ("org_id", "job_id", "revenue_date");
CREATE INDEX "revenue_entries_client_date_idx" ON "pulse"."revenue_entries" ("org_id", "client_id", "revenue_date");
CREATE INDEX "revenue_entries_date_idx" ON "pulse"."revenue_entries" ("org_id", "revenue_date") WHERE "deleted_at" IS NULL;
CREATE INDEX "vas_entries_service_date_idx" ON "pulse"."vas_entries" ("org_id", "vas_service_id", "work_date");
CREATE INDEX "vas_entries_client_date_idx" ON "pulse"."vas_entries" ("org_id", "client_id", "work_date");
CREATE INDEX "vas_entries_date_idx" ON "pulse"."vas_entries" ("org_id", "work_date") WHERE "deleted_at" IS NULL;
CREATE INDEX "vas_entries_job_date_idx" ON "pulse"."vas_entries" ("org_id", "job_id", "work_date") WHERE "deleted_at" IS NULL;
CREATE INDEX "alert_rules_org_idx" ON "pulse"."alert_rules" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- Triggers -------------------------------------------------------------------------------------
-- The activity log is append only. DELETE stays allowed (org cascade, seed wipe, purge, retention).
CREATE OR REPLACE FUNCTION "pulse"."activity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pulse.activity is append only' USING ERRCODE = 'KP002';
END $$;
--> statement-breakpoint
CREATE TRIGGER "activity_no_update" BEFORE UPDATE ON "pulse"."activity"
  FOR EACH ROW EXECUTE FUNCTION "pulse"."activity_immutable"();
--> statement-breakpoint
-- Closed month lock for the eight dated stream tables. TG_ARGV[0] is the date column.
-- Raises SQLSTATE KP001 with the message month_closed:YYYY-MM. Lets the statement through
-- under SET LOCAL pulse.allow_purge = 'on' and when the org row is already gone (org cascade).
CREATE OR REPLACE FUNCTION "pulse"."guard_closed_month"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col    text := TG_ARGV[0];
  d_new  date;
  d_old  date;
  v_org  uuid;
  closed date;
BEGIN
  IF current_setting('pulse.allow_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    d_old := (to_jsonb(OLD) ->> col)::date;
    v_org := OLD.org_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    d_new := (to_jsonb(NEW) ->> col)::date;
    v_org := NEW.org_id;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "core"."organization" WHERE "id" = v_org) THEN
    RETURN OLD;
  END IF;
  SELECT p."period_month" INTO closed
    FROM "pulse"."periods" p
   WHERE p."org_id" = v_org AND p."status" = 'closed'
     AND p."period_month" IN (date_trunc('month', d_new)::date, date_trunc('month', d_old)::date)
   ORDER BY p."period_month"
   LIMIT 1;
  IF closed IS NOT NULL THEN
    RAISE EXCEPTION 'month_closed:%', to_char(closed, 'YYYY-MM') USING ERRCODE = 'KP001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DO $$
DECLARE
  pair text[];
  pairs text[][] := ARRAY[
    ['production_entries','work_date'], ['indirect_entries','work_date'], ['paid_hours','work_date'], ['time_punches','work_date'],
    ['material_usage','usage_date'], ['cost_entries','cost_date'], ['revenue_entries','revenue_date'], ['vas_entries','work_date']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON "pulse".%I FOR EACH ROW EXECUTE FUNCTION "pulse"."guard_closed_month"(%L)',
      pair[1] || '_closed_month', pair[1], pair[2]);
  END LOOP;
END $$;
--> statement-breakpoint
-- Rate that applies to an entry (SPEC 4.3). One row, always.
-- source: 'class' (a dated rate row), 'default' (settings.default_loaded_rate_cents) or 'none'.
CREATE OR REPLACE FUNCTION "pulse"."rate_for"(p_org uuid, p_class uuid, p_site uuid, p_date date)
RETURNS TABLE (found boolean, rate_cents int, overtime_rate_cents int, wage_cents int, overhead_cents int, mult numeric, bill_rate_cents int, rate_id uuid, labor_class_id uuid, source text)
LANGUAGE sql STABLE AS $$
  WITH cls AS (
    SELECT COALESCE(p_class, (SELECT lc."id" FROM "pulse"."labor_classes" lc WHERE lc."org_id" = p_org AND lc."is_default" AND lc."deleted_at" IS NULL LIMIT 1)) AS id
  ), r AS (
    SELECT lr.* FROM "pulse"."labor_rates" lr, cls
     WHERE lr."org_id" = p_org AND lr."labor_class_id" = cls.id AND lr."deleted_at" IS NULL
       AND lr."effective_from" <= p_date AND (lr."site_id" = p_site OR lr."site_id" IS NULL)
     ORDER BY (lr."site_id" IS NOT NULL) DESC, lr."effective_from" DESC
     LIMIT 1
  ), s AS (
    SELECT st."default_loaded_rate_cents" AS d, st."default_overtime_multiplier" AS m FROM "pulse"."settings" st WHERE st."org_id" = p_org
  )
  SELECT true, r."loaded_rate_cents", r."overtime_rate_cents", r."wage_cents", r."overhead_per_hour_cents", r."overtime_multiplier", r."bill_rate_cents", r."id", r."labor_class_id", 'class'::text FROM r
  UNION ALL
  SELECT true, s.d, round(s.d * s.m)::int, s.d, 0, s.m, NULL::int, NULL::uuid, (SELECT id FROM cls), 'default'::text FROM s
   WHERE s.d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM r)
  UNION ALL
  SELECT false, 0, 0, 0, 0, 1.5, NULL::int, NULL::uuid, (SELECT id FROM cls), 'none'::text
   WHERE NOT EXISTS (SELECT 1 FROM r) AND NOT EXISTS (SELECT 1 FROM s WHERE s.d IS NOT NULL)
$$;
--> statement-breakpoint
-- Facts: the row level source of every profit number (SPEC 4.9). `billed_memo` rows are never
-- revenue. Units ride on revenue_base (jobs) and revenue_vas (services) rows; hours on labor rows.
CREATE VIEW "pulse"."v_facts" AS
SELECT p."org_id", p."site_id", j."client_id", p."job_id", j."job_type_id", NULL::uuid AS "vas_service_id", p."work_date",
       'revenue_base'::text AS "kind", p."base_revenue_cents" AS "amount_cents", p."units_good", p."units_scrap", 0::numeric AS "hours",
       'production_entries'::text AS "source_table", p."id" AS "source_id"
  FROM "pulse"."production_entries" p JOIN "pulse"."jobs" j ON j."id" = p."job_id"
 WHERE p."deleted_at" IS NULL AND j."deleted_at" IS NULL
UNION ALL
SELECT p."org_id", p."site_id", j."client_id", p."job_id", j."job_type_id", NULL::uuid, p."work_date",
       'labor', p."labor_cost_cents", 0, 0, p."hours", 'production_entries', p."id"
  FROM "pulse"."production_entries" p JOIN "pulse"."jobs" j ON j."id" = p."job_id"
 WHERE p."deleted_at" IS NULL AND j."deleted_at" IS NULL
UNION ALL
SELECT p."org_id", p."site_id", j."client_id", p."job_id", j."job_type_id", NULL::uuid, p."work_date",
       'material', p."std_material_cents", 0, 0, 0, 'production_entries', p."id"
  FROM "pulse"."production_entries" p JOIN "pulse"."jobs" j ON j."id" = p."job_id"
 WHERE p."deleted_at" IS NULL AND j."deleted_at" IS NULL AND j."material_method" = 'standard' AND p."std_material_cents" <> 0
UNION ALL
SELECT p."org_id", p."site_id", j."client_id", p."job_id", j."job_type_id", NULL::uuid, p."work_date",
       'shared', p."shared_cents", 0, 0, 0, 'production_entries', p."id"
  FROM "pulse"."production_entries" p JOIN "pulse"."jobs" j ON j."id" = p."job_id"
 WHERE p."deleted_at" IS NULL AND j."deleted_at" IS NULL AND p."shared_cents" <> 0
UNION ALL
SELECT m."org_id", m."site_id", j."client_id", m."job_id", j."job_type_id", NULL::uuid, m."usage_date",
       'material', m."cost_cents", 0, 0, 0, 'material_usage', m."id"
  FROM "pulse"."material_usage" m JOIN "pulse"."jobs" j ON j."id" = m."job_id"
 WHERE m."deleted_at" IS NULL AND j."deleted_at" IS NULL AND j."material_method" = 'actual'
UNION ALL
SELECT c."org_id", c."site_id", c."client_id", c."job_id", j."job_type_id", NULL::uuid, c."cost_date",
       'other', c."amount_cents", 0, 0, 0, 'cost_entries', c."id"
  FROM "pulse"."cost_entries" c LEFT JOIN "pulse"."jobs" j ON j."id" = c."job_id"
 WHERE c."deleted_at" IS NULL AND c."scope" IN ('job', 'client') AND (c."job_id" IS NULL OR j."deleted_at" IS NULL)
UNION ALL
SELECT r."org_id", r."site_id", r."client_id", r."job_id", j."job_type_id", r."vas_service_id", r."revenue_date",
       CASE r."kind" WHEN 'invoice' THEN 'billed_memo' WHEN 'fixed_true_up' THEN 'revenue_base' ELSE 'revenue_other' END,
       r."amount_cents", 0, 0, 0, 'revenue_entries', r."id"
  FROM "pulse"."revenue_entries" r LEFT JOIN "pulse"."jobs" j ON j."id" = r."job_id"
 WHERE r."deleted_at" IS NULL AND (r."kind" <> 'invoice' OR r."approved") AND (r."job_id" IS NULL OR j."deleted_at" IS NULL)
UNION ALL
SELECT v."org_id", v."site_id", v."client_id", v."job_id", j."job_type_id", v."vas_service_id", v."work_date",
       'revenue_vas', COALESCE(v."amount_cents", 0), v."quantity", 0, 0, 'vas_entries', v."id"
  FROM "pulse"."vas_entries" v LEFT JOIN "pulse"."jobs" j ON j."id" = v."job_id"
 WHERE v."deleted_at" IS NULL AND (v."job_id" IS NULL OR j."deleted_at" IS NULL)
UNION ALL
SELECT v."org_id", v."site_id", v."client_id", v."job_id", j."job_type_id", v."vas_service_id", v."work_date",
       'labor', v."labor_cost_cents", 0, 0, v."hours", 'vas_entries', v."id"
  FROM "pulse"."vas_entries" v LEFT JOIN "pulse"."jobs" j ON j."id" = v."job_id"
 WHERE v."deleted_at" IS NULL AND (v."job_id" IS NULL OR j."deleted_at" IS NULL) AND (v."labor_cost_cents" <> 0 OR v."hours" <> 0)
UNION ALL
SELECT v."org_id", v."site_id", v."client_id", v."job_id", j."job_type_id", v."vas_service_id", v."work_date",
       'material', v."material_cents", 0, 0, 0, 'vas_entries', v."id"
  FROM "pulse"."vas_entries" v LEFT JOIN "pulse"."jobs" j ON j."id" = v."job_id"
 WHERE v."deleted_at" IS NULL AND (v."job_id" IS NULL OR j."deleted_at" IS NULL) AND v."material_cents" <> 0
UNION ALL
SELECT v."org_id", v."site_id", v."client_id", v."job_id", j."job_type_id", v."vas_service_id", v."work_date",
       'shared', v."shared_cents", 0, 0, 0, 'vas_entries', v."id"
  FROM "pulse"."vas_entries" v LEFT JOIN "pulse"."jobs" j ON j."id" = v."job_id"
 WHERE v."deleted_at" IS NULL AND (v."job_id" IS NULL OR j."deleted_at" IS NULL) AND v."shared_cents" <> 0;
--> statement-breakpoint
-- RLS on every table, no policies: the app role owns the tables (or has BYPASSRLS).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'pulse' LOOP
    EXECUTE format('ALTER TABLE "pulse".%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
