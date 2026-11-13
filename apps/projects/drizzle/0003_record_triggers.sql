-- Cross-app triggers ("recipes"): workspace rules that watch CRM and WMS records and start work in
-- Projects. Unlike pm.automations (task triggers -> task actions) these fire on a sibling record:
--   crm_deal_won            a CRM deal reaches a won stage        -> create a project from a template
--   wms_receipt_discrepancy a WMS receipt has short/over/damaged lines -> urgent task for the receiving lead
--   wms_count_variance      a cycle count is off by more than X%   -> task to investigate
-- config jsonb holds the rule's settings (template id, project id, assignee, threshold, look-back).
--
-- pm.record_trigger_runs: one row per (trigger, record): the dedupe key that stops a record from
-- firing twice, plus what was created (url/label) for the run history.
CREATE TABLE "pm"."record_triggers" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"            text NOT NULL,
  "name"            text NOT NULL,
  "config"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled"         boolean NOT NULL DEFAULT true,
  "since"           timestamptz NOT NULL DEFAULT now(),
  "last_checked_at" timestamptz,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"      timestamptz,
  CONSTRAINT "record_triggers_kind_check" CHECK ("kind" IN ('crm_deal_won', 'wms_receipt_discrepancy', 'wms_count_variance'))
);
--> statement-breakpoint
CREATE INDEX "record_triggers_org_idx" ON "pm"."record_triggers" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."record_triggers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "pm"."record_trigger_runs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "trigger_id"   uuid NOT NULL REFERENCES "pm"."record_triggers"("id") ON DELETE CASCADE,
  "record_type"  text NOT NULL,
  "record_id"    text NOT NULL,
  "record_title" text,
  "status"       text NOT NULL,
  "message"      text NOT NULL,
  "result_url"   text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "record_trigger_runs_status_check" CHECK ("status" IN ('created', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "record_trigger_runs_once_idx" ON "pm"."record_trigger_runs" ("trigger_id", "record_type", "record_id");
--> statement-breakpoint
CREATE INDEX "record_trigger_runs_recent_idx" ON "pm"."record_trigger_runs" ("org_id", "created_at");
--> statement-breakpoint
ALTER TABLE "pm"."record_trigger_runs" ENABLE ROW LEVEL SECURITY;
