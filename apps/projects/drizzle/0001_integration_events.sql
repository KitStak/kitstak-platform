-- Cross-app event inbox. CRM and WMS write here through @kitstak/pm-bridge (shared database,
-- no network hop) when something Projects cares about happens: a CRM deal/account changes stage,
-- a WMS order ships, a task was created from a sibling app. Projects drains pending rows
-- (src/server/integrations/events.ts) and turns them into automation events. Rows are kept for
-- 30 days after processing for troubleshooting.
CREATE TABLE "pm"."integration_events" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "source"        text NOT NULL,
  "kind"          text NOT NULL,
  "target_type"   text,
  "target_id"     text,
  "task_id"       uuid REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "title"         text,
  "before_status" text,
  "after_status"  text,
  "url"           text,
  "actor_id"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "payload"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "processed_at"  timestamptz,
  "attempts"      integer NOT NULL DEFAULT 0,
  "error"         text,
  CONSTRAINT "integration_events_source_check" CHECK ("source" IN ('crm', 'wms', 'portal', 'projects')),
  CONSTRAINT "integration_events_kind_check" CHECK ("kind" IN ('record_status_changed', 'task_created')),
  CONSTRAINT "integration_events_target_type_check" CHECK ("target_type" IS NULL OR "target_type" IN ('crm_item', 'crm_account', 'core_customer', 'wms_order', 'wms_work_order', 'wms_receipt', 'wms_count'))
);
--> statement-breakpoint
CREATE INDEX "integration_events_pending_idx" ON "pm"."integration_events" ("org_id", "created_at") WHERE "processed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "integration_events_target_idx" ON "pm"."integration_events" ("org_id", "target_type", "target_id", "created_at");
--> statement-breakpoint
ALTER TABLE "pm"."integration_events" ENABLE ROW LEVEL SECURITY;
