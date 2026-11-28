-- KitStak Crew: the `crew` schema, Phase 0 (docs/crew/SPEC.md sections 5.1, 5.2 and 5.8).
-- Hand written (never drizzle-kit push); mirrored for types in apps/crew/src/server/db/schema/*.ts.
--
-- House rules (SPEC section 5, the Pulse conventions):
--   * uuid PKs, timestamptz, every row org scoped (org_id REFERENCES core.organization ON DELETE CASCADE),
--     enums as text + CHECK.
--   * Every table with an id has UNIQUE (org_id, id), and every crew to crew FK is the composite
--     (org_id, x_id), so a row can never point at another workspace's parent. NO ACTION stands in for
--     RESTRICT so an org cascade can remove parents and children in one statement.
--   * User columns point at core."user" ON DELETE SET NULL. Columns that point into sibling schemas
--     (pulse_*, wms_*, pm_*, crm_*) have no FK, because the sibling may be absent.
--   * Row level security with one policy per table from day one (crew.org_id), and the plain role
--     crew_app for the database guard (CREW_DB_GUARD=1), the Pulse 0007, 0009 and 0012 pattern.
--
-- Crew does NOT touch the core.entitlements module CHECK: Crew is a preview app until launch
-- (SPEC 3.4). The launch PR adds `00NN_crew_entitlement.sql`.
-- Later phases add 0001 schedule, 0002 clock, 0003 approvals, 0004 attendance, 0005 skills, 0006 plan.
CREATE SCHEMA IF NOT EXISTS "crew";
--> statement-breakpoint
-- 5.1 Setup ------------------------------------------------------------------------------------
CREATE TABLE "crew"."settings" (
  "org_id"               uuid PRIMARY KEY REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "default_member_role"  text NOT NULL DEFAULT 'none' CHECK ("default_member_role" IN ('supervisor', 'lead', 'viewer', 'none')),
  "week_start"           smallint NOT NULL DEFAULT 0 CHECK ("week_start" BETWEEN 0 AND 6),
  "default_timezone"     text NOT NULL DEFAULT 'America/Chicago',
  "pin_length"           smallint NOT NULL DEFAULT 4 CHECK ("pin_length" IN (4, 6)),
  "phone_clock"          boolean NOT NULL DEFAULT true,
  "fence_mode"           text NOT NULL DEFAULT 'flag' CHECK ("fence_mode" IN ('off', 'flag', 'block')),
  "punch_photos"         boolean NOT NULL DEFAULT false,
  "photo_retention_days" smallint NOT NULL DEFAULT 90 CHECK ("photo_retention_days" BETWEEN 1 AND 3650),
  "schedule_email"       boolean NOT NULL DEFAULT true,
  "agency_links"         boolean NOT NULL DEFAULT true,
  "number_prefix_temp"   text NOT NULL DEFAULT 'T-',
  "number_seq"           int NOT NULL DEFAULT 1000 CHECK ("number_seq" >= 0),
  "indirect_bp"          int NOT NULL DEFAULT 0 CHECK ("indirect_bp" BETWEEN 0 AND 100000),
  "onboarding"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sample_loaded_at"     timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew"."member_roles" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "role"       text NOT NULL CHECK ("role" IN ('owner', 'admin', 'payroll', 'supervisor', 'lead', 'viewer', 'none')),
  "site_ids"   uuid[],
  "updated_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "member_roles_org_user_key" UNIQUE ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "crew"."sites" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"                text NOT NULL CHECK (length(btrim("code")) > 0),
  "name"                text NOT NULL CHECK (length(btrim("name")) > 0),
  "timezone"            text NOT NULL,
  "is_default"          boolean NOT NULL DEFAULT false,
  "address"             jsonb,
  "geo_lat"             numeric(9,6) CHECK ("geo_lat" IS NULL OR "geo_lat" BETWEEN -90 AND 90),
  "geo_lng"             numeric(9,6) CHECK ("geo_lng" IS NULL OR "geo_lng" BETWEEN -180 AND 180),
  "fence_radius_m"      int NOT NULL DEFAULT 150 CHECK ("fence_radius_m" BETWEEN 25 AND 5000),
  "week_start"          smallint NOT NULL CHECK ("week_start" BETWEEN 0 AND 6),
  -- Points at crew.shift_templates, which arrives in 0001 (Phase 2) with its FK.
  "default_template_id" uuid,
  "pulse_site_id"       uuid,
  "wms_warehouse_id"    text,
  "last_rollover_date"  date,
  "archived_at"         timestamptz,
  "version"             int NOT NULL DEFAULT 1,
  "deleted_at"          timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew"."site_rules" (
  "id"                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"                        uuid NOT NULL,
  "effective_from"                 date NOT NULL,
  "preset"                         text NOT NULL DEFAULT 'federal' CHECK ("preset" IN ('federal', 'california', 'custom')),
  "rounding_mode"                  text NOT NULL DEFAULT 'exact' CHECK ("rounding_mode" IN ('exact', 'nearest', 'worker_favor')),
  "round_increment_minutes"        smallint CHECK ("round_increment_minutes" IN (5, 6, 10, 15)),
  "late_grace_minutes"             smallint NOT NULL DEFAULT 5 CHECK ("late_grace_minutes" BETWEEN 0 AND 120),
  "early_out_grace_minutes"        smallint NOT NULL DEFAULT 5 CHECK ("early_out_grace_minutes" BETWEEN 0 AND 120),
  "short_break_paid_under_minutes" smallint NOT NULL DEFAULT 20 CHECK ("short_break_paid_under_minutes" BETWEEN 0 AND 120),
  "ot_weekly_minutes"              int DEFAULT 2400 CHECK ("ot_weekly_minutes" IS NULL OR "ot_weekly_minutes" BETWEEN 1 AND 10080),
  "ot_daily_minutes"               int CHECK ("ot_daily_minutes" IS NULL OR "ot_daily_minutes" BETWEEN 1 AND 1440),
  "dt_daily_minutes"               int CHECK ("dt_daily_minutes" IS NULL OR "dt_daily_minutes" BETWEEN 1 AND 1440),
  "seventh_day_rule"               boolean NOT NULL DEFAULT false,
  "note"                           text,
  "version"                        int NOT NULL DEFAULT 1,
  "created_at"                     timestamptz NOT NULL DEFAULT now(),
  "updated_at"                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "site_rules_increment_needed" CHECK ("rounding_mode" = 'exact' OR "round_increment_minutes" IS NOT NULL),
  CONSTRAINT "site_rules_dt_after_ot" CHECK ("dt_daily_minutes" IS NULL OR "ot_daily_minutes" IS NULL OR "dt_daily_minutes" > "ot_daily_minutes"),
  CONSTRAINT "site_rules_site_from_key" UNIQUE ("org_id", "site_id", "effective_from")
);
--> statement-breakpoint
CREATE TABLE "crew"."break_rules" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_rule_id"         uuid NOT NULL,
  "kind"                 text NOT NULL CHECK ("kind" IN ('meal', 'rest')),
  "nth"                  smallint NOT NULL DEFAULT 1 CHECK ("nth" BETWEEN 1 AND 9),
  "after_worked_minutes" int NOT NULL CHECK ("after_worked_minutes" BETWEEN 0 AND 1440),
  "min_minutes"          smallint NOT NULL CHECK ("min_minutes" BETWEEN 1 AND 240),
  "paid"                 boolean NOT NULL,
  "checked"              boolean NOT NULL DEFAULT true,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "break_rules_key" UNIQUE ("org_id", "site_rule_id", "kind", "nth")
);
--> statement-breakpoint
CREATE TABLE "crew"."areas" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "site_id"     uuid NOT NULL,
  "code"        text NOT NULL CHECK (length(btrim("code")) > 0),
  "name"        text NOT NULL CHECK (length(btrim("name")) > 0),
  "color"       text,
  "position"    int NOT NULL DEFAULT 0,
  "archived_at" timestamptz,
  "deleted_at"  timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew"."labor_classes" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"                 text NOT NULL CHECK (length(btrim("code")) > 0),
  "name"                 text NOT NULL CHECK (length(btrim("name")) > 0),
  "kind"                 text NOT NULL DEFAULT 'employee' CHECK ("kind" IN ('employee', 'temp_agency')),
  "is_default"           boolean NOT NULL DEFAULT false,
  "pulse_labor_class_id" uuid,
  "archived_at"          timestamptz,
  "deleted_at"           timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- 5.2 People -----------------------------------------------------------------------------------
-- Temp agencies are rows of core.vendors (packages/db 0012) whose kinds hold 'temp_agency'.
CREATE TABLE "crew"."people" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"           text NOT NULL CHECK (length(btrim("number")) > 0),
  "first_name"       text NOT NULL CHECK (length(btrim("first_name")) > 0),
  "last_name"        text NOT NULL CHECK (length(btrim("last_name")) > 0),
  "preferred_name"   text,
  "kind"             text NOT NULL DEFAULT 'employee' CHECK ("kind" IN ('employee', 'temp', 'seasonal')),
  "status"           text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'on_leave', 'ended')),
  "home_site_id"     uuid NOT NULL,
  "usual_area_id"    uuid,
  "labor_class_id"   uuid,
  "lead_person_id"   uuid,
  "agency_vendor_id" uuid REFERENCES "core"."vendors"("id") ON DELETE RESTRICT,
  "agency_ref"       text,
  "start_date"       date,
  "end_date"         date,
  "user_id"          uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "wms_user_id"      text,
  "email"            text,
  "phone"            text,
  "language"         text NOT NULL DEFAULT 'en' CHECK ("language" IN ('en', 'es')),
  "badge_hash"       text,
  "pin_hash"         text,
  "pin_set_at"       timestamptz,
  "pin_fails"        smallint NOT NULL DEFAULT 0 CHECK ("pin_fails" >= 0),
  "pin_locked_until" timestamptz,
  "notify_email"     boolean NOT NULL DEFAULT true,
  "external_refs"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes"            text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "people_agency_only_temps" CHECK ("agency_vendor_id" IS NULL OR "kind" = 'temp'),
  CONSTRAINT "people_dates_in_order" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT "people_ended_has_end_date" CHECK ("status" <> 'ended' OR "end_date" IS NOT NULL),
  CONSTRAINT "people_not_own_lead" CHECK ("lead_person_id" IS NULL OR "lead_person_id" <> "id")
);
--> statement-breakpoint
CREATE TABLE "crew"."person_private" (
  "org_id"             uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "person_id"          uuid NOT NULL,
  "emergency_name"     text,
  "emergency_phone"    text,
  "emergency_relation" text,
  "home_address"       jsonb,
  "private_notes"      text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "person_private_pkey" PRIMARY KEY ("org_id", "person_id")
);
--> statement-breakpoint
CREATE TABLE "crew"."person_pay" (
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "person_id"       uuid NOT NULL,
  "pay_type"        text NOT NULL DEFAULT 'hourly' CHECK ("pay_type" IN ('hourly', 'salary')),
  "overtime_exempt" boolean NOT NULL DEFAULT false,
  "updated_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "person_pay_pkey" PRIMARY KEY ("org_id", "person_id")
);
--> statement-breakpoint
CREATE TABLE "crew"."person_wages" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "person_id"        uuid NOT NULL,
  "effective_from"   date NOT NULL,
  "wage_cents"       int NOT NULL CHECK ("wage_cents" BETWEEN 0 AND 1000000),
  "note"             text,
  "sent_to_pulse_at" timestamptz,
  "version"          int NOT NULL DEFAULT 1,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "person_wages_key" UNIQUE ("org_id", "person_id", "effective_from")
);
--> statement-breakpoint
CREATE TABLE "crew"."agency_links" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "vendor_id"    uuid NOT NULL REFERENCES "core"."vendors"("id") ON DELETE RESTRICT,
  "site_id"      uuid NOT NULL,
  "token_hash"   text NOT NULL UNIQUE,
  "token_prefix" text,
  "expires_at"   timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  "max_people"   int NOT NULL DEFAULT 50 CHECK ("max_people" BETWEEN 1 AND 500),
  "revoked_at"   timestamptz,
  "created_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "deleted_at"   timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The form asks for nothing else: no tax ids, no birth dates (SPEC 5.2).
CREATE TABLE "crew"."agency_submissions" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "link_id"    uuid NOT NULL,
  "first_name" text NOT NULL,
  "last_name"  text NOT NULL,
  "phone"      text,
  "email"      text,
  "agency_ref" text,
  "start_date" date,
  "language"   text NOT NULL DEFAULT 'en' CHECK ("language" IN ('en', 'es')),
  "status"     text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'rejected')),
  "person_id"  uuid,
  "decided_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "decided_at" timestamptz,
  "ip_hash"    text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- 5.8 Control and system -----------------------------------------------------------------------
CREATE TABLE "crew"."attachments" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "owner_type"   text NOT NULL CHECK ("owner_type" IN ('certification', 'punch_photo', 'payroll_export', 'import')),
  "owner_id"     uuid,
  "name"         text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes"   int NOT NULL CHECK ("size_bytes" BETWEEN 0 AND 5242880),
  "storage"      text NOT NULL CHECK ("storage" IN ('blob', 'db')),
  "storage_key"  text,
  "data"         bytea,
  "expires_at"   timestamptz,
  "uploaded_by"  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachments_where_stored" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'blob' AND "storage_key" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "crew"."activity" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "actor_id"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "actor_kind"  text NOT NULL DEFAULT 'user' CHECK ("actor_kind" IN ('user', 'device', 'system', 'integration')),
  "verb"        text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id"   uuid,
  "before"      jsonb,
  "after"       jsonb,
  "meta"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew"."notifications" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"     uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "kind"        text NOT NULL,
  "params"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "url"         text CHECK ("url" IS NULL OR ("url" LIKE '/%' AND "url" NOT LIKE '//%')),
  "read_at"     timestamptz,
  "archived_at" timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew"."outbox_email" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "person_id"       uuid,
  "kind"            text NOT NULL,
  "params"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text NOT NULL UNIQUE,
  "status"          text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  "attempts"        int NOT NULL DEFAULT 0,
  "sent_at"         timestamptz,
  "error"           text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The Pulse import tables with Crew stream names (SPEC section 7).
CREATE TABLE "crew"."import_batches" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "stream"          text NOT NULL CHECK ("stream" IN ('people', 'certifications', 'skills', 'time_off_balances', 'plan_inputs')),
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
CREATE TABLE "crew"."import_rows" (
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
CREATE TABLE "crew"."import_presets" (
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
CREATE TABLE "crew"."user_prefs" (
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"         uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "default_site_id" uuid,
  "schedule_view"   text CHECK ("schedule_view" IS NULL OR "schedule_view" IN ('area', 'shift', 'day')),
  "hidden_tips"     text[] NOT NULL DEFAULT '{}',
  "prefs"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "crew"."sync_state" (
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "source"       text NOT NULL CHECK ("source" IN ('pulse', 'projects', 'wms', 'crm')),
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
CREATE TABLE "crew"."sync_runs" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "source"      text NOT NULL CHECK ("source" IN ('pulse', 'projects', 'wms', 'crm')),
  "started_at"  timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "status"      text NOT NULL DEFAULT 'running' CHECK ("status" IN ('running', 'ok', 'failed', 'skipped')),
  "created"     int NOT NULL DEFAULT 0,
  "updated"     int NOT NULL DEFAULT 0,
  "skipped"     int NOT NULL DEFAULT 0,
  "error"       text,
  "trigger"     text NOT NULL DEFAULT 'manual' CHECK ("trigger" IN ('cron', 'manual', 'page')),
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew"."dismissals" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"       text NOT NULL,
  "target_id"  text NOT NULL,
  "user_id"    uuid REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "until"      timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Shared columns -------------------------------------------------------------------------------
-- SRC: where a row came from, so a sync or a re-import is an upsert on (org_id, source, source_ref).
-- V on people (the other V tables carry `version` inline above).
DO $$
DECLARE
  t text;
  src_tables text[] := ARRAY['labor_classes', 'people'];
BEGIN
  ALTER TABLE "crew"."people" ADD COLUMN "version" int NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" timestamptz;
  FOREACH t IN ARRAY src_tables LOOP
    EXECUTE format($f$ALTER TABLE "crew".%I
      ADD COLUMN "source" text NOT NULL DEFAULT 'manual' CHECK ("source" IN ('manual','csv','kiosk','phone','agency_link','pulse','projects','wms','crm','system','sample')),
      ADD COLUMN "source_ref" text,
      ADD COLUMN "import_batch_id" uuid,
      ADD COLUMN "is_sample" boolean NOT NULL DEFAULT false,
      ADD COLUMN "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
      ADD COLUMN "updated_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL$f$, t);
    EXECUTE format('CREATE UNIQUE INDEX %I ON "crew".%I ("org_id", "source", "source_ref") WHERE "source_ref" IS NOT NULL AND "deleted_at" IS NULL', t || '_source_ref_key', t);
  END LOOP;
  -- No cross org pointers: every table with an id gets UNIQUE (org_id, id).
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'crew' AND c.column_name = 'id' ORDER BY c.table_name LOOP
    EXECUTE format('ALTER TABLE "crew".%I ADD CONSTRAINT %I UNIQUE ("org_id", "id")', t, t || '_org_id_id_key');
  END LOOP;
END $$;
--> statement-breakpoint
-- Composite foreign keys: child(org_id, column) references parent(org_id, id). 'c' cascades from its parent.
DO $$
DECLARE
  fk text[];
  fks text[][] := ARRAY[
    ['site_rules', 'site_id', 'sites', 'n'],
    ['break_rules', 'site_rule_id', 'site_rules', 'c'],
    ['areas', 'site_id', 'sites', 'n'],
    ['people', 'home_site_id', 'sites', 'n'], ['people', 'usual_area_id', 'areas', 'n'],
    ['people', 'labor_class_id', 'labor_classes', 'n'], ['people', 'lead_person_id', 'people', 'n'],
    ['person_private', 'person_id', 'people', 'c'], ['person_pay', 'person_id', 'people', 'c'], ['person_wages', 'person_id', 'people', 'c'],
    ['agency_links', 'site_id', 'sites', 'n'],
    ['agency_submissions', 'link_id', 'agency_links', 'c'], ['agency_submissions', 'person_id', 'people', 'n'],
    ['import_rows', 'batch_id', 'import_batches', 'c'],
    ['user_prefs', 'default_site_id', 'sites', 'n']
  ];
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fks LOOP
    EXECUTE format('ALTER TABLE "crew".%I ADD CONSTRAINT %I FOREIGN KEY ("org_id", %I) REFERENCES "crew".%I ("org_id", "id")%s',
      fk[1], fk[1] || '_' || fk[2] || '_fkey', fk[2], fk[3], CASE WHEN fk[4] = 'c' THEN ' ON DELETE CASCADE' ELSE '' END);
  END LOOP;
END $$;
--> statement-breakpoint
-- Unique keys and indexes ----------------------------------------------------------------------
CREATE UNIQUE INDEX "sites_code_key" ON "crew"."sites" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "sites_default_key" ON "crew"."sites" ("org_id") WHERE "is_default" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "sites_pulse_key" ON "crew"."sites" ("org_id", "pulse_site_id") WHERE "pulse_site_id" IS NOT NULL;
CREATE UNIQUE INDEX "sites_wms_key" ON "crew"."sites" ("org_id", "wms_warehouse_id") WHERE "wms_warehouse_id" IS NOT NULL;
CREATE INDEX "site_rules_site_from_idx" ON "crew"."site_rules" ("org_id", "site_id", "effective_from" DESC);
CREATE UNIQUE INDEX "areas_code_key" ON "crew"."areas" ("org_id", "site_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "labor_classes_code_key" ON "crew"."labor_classes" ("org_id", lower("code")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "labor_classes_pulse_key" ON "crew"."labor_classes" ("org_id", "pulse_labor_class_id") WHERE "pulse_labor_class_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "labor_classes_default_key" ON "crew"."labor_classes" ("org_id") WHERE "is_default" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "people_number_key" ON "crew"."people" ("org_id", lower("number")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "people_user_key" ON "crew"."people" ("org_id", "user_id") WHERE "user_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "people_badge_key" ON "crew"."people" ("org_id", "badge_hash") WHERE "badge_hash" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "people_wms_user_key" ON "crew"."people" ("org_id", "wms_user_id") WHERE "wms_user_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "people_status_idx" ON "crew"."people" ("org_id", "status");
CREATE INDEX "people_home_site_idx" ON "crew"."people" ("org_id", "home_site_id");
CREATE INDEX "people_agency_idx" ON "crew"."people" ("org_id", "agency_vendor_id");
CREATE INDEX "people_lead_idx" ON "crew"."people" ("org_id", "lead_person_id");
CREATE INDEX "people_name_idx" ON "crew"."people" ("org_id", lower("last_name"), lower("first_name"));
CREATE INDEX "agency_links_vendor_idx" ON "crew"."agency_links" ("org_id", "vendor_id");
CREATE INDEX "agency_submissions_link_idx" ON "crew"."agency_submissions" ("org_id", "link_id", "status");
CREATE INDEX "attachments_owner_idx" ON "crew"."attachments" ("org_id", "owner_type", "owner_id");
CREATE INDEX "attachments_expires_idx" ON "crew"."attachments" ("expires_at") WHERE "expires_at" IS NOT NULL;
CREATE INDEX "activity_org_created_idx" ON "crew"."activity" ("org_id", "created_at" DESC);
CREATE INDEX "activity_org_entity_idx" ON "crew"."activity" ("org_id", "entity_type", "entity_id");
CREATE INDEX "notifications_user_idx" ON "crew"."notifications" ("org_id", "user_id", "read_at");
CREATE INDEX "outbox_email_status_idx" ON "crew"."outbox_email" ("status", "created_at") WHERE "status" IN ('pending', 'failed');
CREATE INDEX "import_batches_org_created_idx" ON "crew"."import_batches" ("org_id", "created_at" DESC);
CREATE INDEX "import_batches_hash_idx" ON "crew"."import_batches" ("org_id", "stream", "file_hash");
CREATE INDEX "import_rows_batch_row_idx" ON "crew"."import_rows" ("batch_id", "row_number");
CREATE INDEX "import_rows_batch_action_idx" ON "crew"."import_rows" ("batch_id", "action");
CREATE INDEX "sync_runs_org_source_idx" ON "crew"."sync_runs" ("org_id", "source", "started_at" DESC);
CREATE UNIQUE INDEX "dismissals_key" ON "crew"."dismissals" ("org_id", "kind", "target_id", COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
-- Triggers -------------------------------------------------------------------------------------
-- The activity log is append only. DELETE stays allowed (org cascade, seed wipe, purge, retention).
CREATE OR REPLACE FUNCTION "crew"."activity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crew.activity is append only' USING ERRCODE = 'KC002';
END $$;
--> statement-breakpoint
CREATE TRIGGER "activity_no_update" BEFORE UPDATE ON "crew"."activity"
  FOR EACH ROW EXECUTE FUNCTION "crew"."activity_immutable"();
--> statement-breakpoint
-- core.vendors has no UNIQUE (org_id, id), so a composite FK is not possible. This trigger keeps
-- the same promise: a person's agency and an agency link's vendor belong to the same workspace.
CREATE OR REPLACE FUNCTION "crew"."vendor_same_org"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col      text := TG_ARGV[0];
  v_vendor uuid := (to_jsonb(NEW) ->> col)::uuid;
BEGIN
  IF v_vendor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "core"."vendors" v WHERE v."id" = v_vendor AND v."org_id" = NEW."org_id") THEN
    RAISE EXCEPTION 'vendor_other_org' USING ERRCODE = '23503', DETAIL = 'The vendor is not in this workspace.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "people_vendor_same_org" BEFORE INSERT OR UPDATE OF "agency_vendor_id", "org_id" ON "crew"."people"
  FOR EACH ROW EXECUTE FUNCTION "crew"."vendor_same_org"('agency_vendor_id');
--> statement-breakpoint
CREATE TRIGGER "agency_links_vendor_same_org" BEFORE INSERT OR UPDATE OF "vendor_id", "org_id" ON "crew"."agency_links"
  FOR EACH ROW EXECUTE FUNCTION "crew"."vendor_same_org"('vendor_id');
--> statement-breakpoint
-- Row level security (the Pulse 0007 policy) ---------------------------------------------------
-- A row is allowed only when its org_id equals the session setting crew.org_id. A role with no
-- setting sees nothing and writes nothing; a setting that is not a uuid is an error (fails closed).
-- Not FORCED: the owner (the migration login) keeps working as before. A table added by a later
-- migration needs its own policy there; src/server/domain/rls.db.test.ts fails when one has none.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename,
           EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
           ) AS has_org
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'crew' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE "crew".%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "crew_org_isolation" ON "crew".%I', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "crew_deny_all" ON "crew".%I', t.tablename);
    IF t.has_org THEN
      EXECUTE format(
        'CREATE POLICY "crew_org_isolation" ON "crew".%I AS PERMISSIVE FOR ALL TO PUBLIC '
        || 'USING ("org_id" = (SELECT NULLIF(current_setting(''crew.org_id'', true), '''')::uuid)) '
        || 'WITH CHECK ("org_id" = (SELECT NULLIF(current_setting(''crew.org_id'', true), '''')::uuid))',
        t.tablename
      );
    ELSE
      EXECUTE format('CREATE POLICY "crew_deny_all" ON "crew".%I AS PERMISSIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)', t.tablename);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- The plain role for the database guard (the Pulse 0009 and 0012 pattern) ----------------------
-- crew_app owns nothing, cannot sign in, is not a superuser and cannot skip row level security.
-- With CREW_DB_GUARD=1 the app opens every statement with
--   SET LOCAL ROLE crew_app; SELECT set_config('crew.org_id', '<org uuid>', true)
-- Each step is safe to run again; a step the migration login may not do is skipped with a NOTICE
-- and /api/health (with the health token) says what to run by hand.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    CREATE ROLE crew_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'crew 0000: skipped CREATE ROLE crew_app (not allowed for %). Ask a database admin to make it.', current_user;
  WHEN duplicate_object THEN
    NULL;
END $$;
--> statement-breakpoint
-- Let the migration login SET ROLE crew_app. On PostgreSQL 16 and newer the SET option is what
-- SET ROLE needs (an ADMIN only membership is not enough); older servers use plain membership.
DO $$
DECLARE
  modern constant boolean := current_setting('server_version_num')::int >= 160000;
  can_set boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    RAISE NOTICE 'crew 0000: role crew_app is missing, nothing to grant.';
    RETURN;
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  can_set := CASE WHEN modern THEN pg_has_role(current_user, 'crew_app', 'SET') ELSE pg_has_role(current_user, 'crew_app', 'MEMBER') END;
  IF can_set THEN
    RETURN;
  END IF;
  IF modern THEN
    EXECUTE format('GRANT crew_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT crew_app TO %I', current_user);
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'crew 0000: skipped GRANT crew_app TO % (not allowed). Ask a database admin to run: GRANT crew_app TO % WITH SET TRUE;', current_user, current_user;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    RAISE NOTICE 'crew 0000: role crew_app is missing, grants skipped.';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA crew TO crew_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA crew TO crew_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA crew TO crew_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crew TO crew_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA crew GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crew_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA crew GRANT USAGE, SELECT ON SEQUENCES TO crew_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA crew GRANT EXECUTE ON FUNCTIONS TO crew_app;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'crew 0000: skipped the grants on schema crew (not allowed for %).', current_user;
END $$;
--> statement-breakpoint
-- crew_app reads the core rows of its own workspace (organization, member, user) and reads and
-- writes its own workspace's vendors (Crew adds temp agencies through upsertVendorKind). Each
-- grant sits behind a policy for crew_app only; no other role and no other app changes.
DO $$
DECLARE
  org_setting constant text := '(SELECT NULLIF(current_setting(''crew.org_id'', true), '''')::uuid)';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crew_app') THEN
    RAISE NOTICE 'crew 0000: role crew_app is missing, core grants skipped.';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA core TO crew_app;
  GRANT SELECT ON core.organization, core.member, core."user" TO crew_app;
  GRANT SELECT, INSERT, UPDATE ON core.vendors TO crew_app;

  DROP POLICY IF EXISTS "crew_app_read_own_org" ON core.organization;
  EXECUTE 'CREATE POLICY "crew_app_read_own_org" ON core.organization AS PERMISSIVE FOR SELECT TO crew_app USING ("id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "crew_app_read_own_org" ON core.member;
  EXECUTE 'CREATE POLICY "crew_app_read_own_org" ON core.member AS PERMISSIVE FOR SELECT TO crew_app USING ("organization_id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "crew_app_read_own_org" ON core."user";
  EXECUTE 'CREATE POLICY "crew_app_read_own_org" ON core."user" AS PERMISSIVE FOR SELECT TO crew_app USING ("id" IN (SELECT m."user_id" FROM core.member m WHERE m."organization_id" = ' || org_setting || '))';

  DROP POLICY IF EXISTS "crew_app_own_org" ON core.vendors;
  EXECUTE 'CREATE POLICY "crew_app_own_org" ON core.vendors AS PERMISSIVE FOR ALL TO crew_app USING ("org_id" = ' || org_setting || ') WITH CHECK ("org_id" = ' || org_setting || ')';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'crew 0000: skipped the grants on core (not allowed for %).', current_user;
END $$;
