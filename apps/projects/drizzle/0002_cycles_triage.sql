-- Cycles (time-boxed sprints) and Triage (intake queue).
--
-- pm.cycles: one row per cycle of a project, numbered per project ("Cycle 4"). A cycle is
-- upcoming / current / done by its dates; completed_at is set when it closes (by hand or by the
-- lazy rollover when the end date has passed). On close, unfinished tasks move to the next cycle.
--
-- pm.cycle_tasks: membership history. A task is in at most one cycle at a time (removed_at is
-- null). Rows are never deleted, so the cycle report can draw scope changes over time.
-- removed_reason: 'removed' (taken out by hand), 'moved' (put in another cycle), 'rolled_over'
-- (still open when the cycle closed).
--
-- pm.triage_items: requests that wait before they become tasks (form answers, CRM, sibling apps,
-- or typed in). Accept turns one into a task; decline, snooze or merge into an existing task.
CREATE TABLE "pm"."cycles" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"    uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "number"        integer NOT NULL,
  "name"          text,
  "goal"          text,
  "start_date"    date NOT NULL,
  "end_date"      date NOT NULL,
  "auto_rollover" boolean NOT NULL DEFAULT true,
  "completed_at"  timestamptz,
  "created_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "deleted_at"    timestamptz,
  CONSTRAINT "cycles_dates_check" CHECK ("end_date" >= "start_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_project_number_idx" ON "pm"."cycles" ("project_id", "number");
--> statement-breakpoint
CREATE INDEX "cycles_project_dates_idx" ON "pm"."cycles" ("project_id", "start_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pm"."cycles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "pm"."cycle_tasks" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "cycle_id"       uuid NOT NULL REFERENCES "pm"."cycles"("id") ON DELETE CASCADE,
  "task_id"        uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "added_at"       timestamptz NOT NULL DEFAULT now(),
  "added_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "removed_at"     timestamptz,
  "removed_reason" text,
  CONSTRAINT "cycle_tasks_reason_check" CHECK ("removed_reason" IS NULL OR "removed_reason" IN ('removed', 'moved', 'rolled_over'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_tasks_active_idx" ON "pm"."cycle_tasks" ("task_id") WHERE "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "cycle_tasks_cycle_idx" ON "pm"."cycle_tasks" ("cycle_id");
--> statement-breakpoint
ALTER TABLE "pm"."cycle_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "pm"."triage_items" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"         uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "title"              text NOT NULL,
  "description"        text,
  "priority"           text NOT NULL DEFAULT 'none',
  "source"             text NOT NULL DEFAULT 'manual',
  "source_label"       text,
  "form_id"            uuid REFERENCES "pm"."forms"("id") ON DELETE SET NULL,
  "link_type"          text,
  "link_id"            text,
  "requester_id"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "requester_name"     text,
  "requester_email"    text,
  "state"              text NOT NULL DEFAULT 'pending',
  "snoozed_until"      date,
  "decline_reason"     text,
  "task_id"            uuid REFERENCES "pm"."tasks"("id") ON DELETE SET NULL,
  "decided_by"         uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "decided_at"         timestamptz,
  "created_by"         uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "triage_items_state_check" CHECK ("state" IN ('pending', 'snoozed', 'accepted', 'declined', 'merged')),
  CONSTRAINT "triage_items_source_check" CHECK ("source" IN ('manual', 'form', 'crm', 'wms', 'portal', 'api')),
  CONSTRAINT "triage_items_priority_check" CHECK ("priority" IN ('urgent', 'high', 'medium', 'low', 'none'))
);
--> statement-breakpoint
CREATE INDEX "triage_items_queue_idx" ON "pm"."triage_items" ("project_id", "state", "created_at");
--> statement-breakpoint
ALTER TABLE "pm"."triage_items" ENABLE ROW LEVEL SECURITY;
