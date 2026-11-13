-- KitStak Projects: the `pm` schema. Hand-written (never drizzle-kit push); mirrors
-- apps/projects/src/server/db/schema/*.ts. Conventions: uuid PKs, timestamptz, org-scoped
-- rows (FK core.organization ON DELETE CASCADE), soft delete via deleted_at, enums as text + CHECK.
CREATE SCHEMA IF NOT EXISTS "pm";
--> statement-breakpoint
-- The projects module must be licensable even when this runs before packages/db 0003.
DO $$
BEGIN
  IF to_regclass('core.entitlements') IS NOT NULL THEN
    ALTER TABLE "core"."entitlements" DROP CONSTRAINT IF EXISTS "entitlements_module_check";
    ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_module_check"
      CHECK ("module" IN ('crm', 'wms', 'projects'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "pm"."spaces" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "description" text,
  "color"       text NOT NULL DEFAULT 'blue',
  "icon"        text NOT NULL DEFAULT 'folder',
  "position"    text NOT NULL,
  "is_private"  boolean NOT NULL DEFAULT false,
  "created_by"  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz,
  "deleted_at"  timestamptz
);
--> statement-breakpoint
CREATE INDEX "spaces_org_idx" ON "pm"."spaces" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "pm"."user_prefs" (
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "prefs"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "pm"."favorites" (
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"     uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id"   uuid NOT NULL,
  "position"    text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id", "entity_type", "entity_id"),
  CONSTRAINT "favorites_entity_type_check" CHECK ("entity_type" IN ('project', 'space', 'goal', 'dashboard', 'view'))
);
--> statement-breakpoint
CREATE TABLE "pm"."recents" (
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"     uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id"   uuid NOT NULL,
  "visited_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recents_pkey" PRIMARY KEY ("user_id", "entity_type", "entity_id"),
  CONSTRAINT "recents_entity_type_check" CHECK ("entity_type" IN ('project', 'task', 'goal', 'dashboard'))
);
--> statement-breakpoint
CREATE INDEX "recents_user_visited_idx" ON "pm"."recents" ("org_id", "user_id", "visited_at");
--> statement-breakpoint
CREATE TABLE "pm"."projects" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "space_id"        uuid REFERENCES "pm"."spaces"("id") ON DELETE SET NULL,
  "key"             text NOT NULL,
  "name"            text NOT NULL,
  "description"     text,
  "status"          text NOT NULL DEFAULT 'active',
  "health"          text NOT NULL DEFAULT 'on_track',
  "health_note"     text,
  "owner_id"        uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "start_date"      date,
  "due_date"        date,
  "color"           text NOT NULL DEFAULT 'blue',
  "icon"            text NOT NULL DEFAULT 'folder-kanban',
  "visibility"      text NOT NULL DEFAULT 'org',
  "crm_customer_id" uuid REFERENCES "core"."customers"("id") ON DELETE SET NULL,
  "crm_item_id"     uuid,
  "wms_ref"         jsonb,
  "is_template"     boolean NOT NULL DEFAULT false,
  "template_id"     uuid,
  "task_seq"        integer NOT NULL DEFAULT 0,
  "position"        text NOT NULL,
  "settings"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "completed_at"    timestamptz,
  "archived_at"     timestamptz,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"      timestamptz,
  CONSTRAINT "projects_status_check" CHECK ("status" IN ('planning', 'active', 'on_hold', 'completed', 'archived')),
  CONSTRAINT "projects_health_check" CHECK ("health" IN ('on_track', 'at_risk', 'off_track')),
  CONSTRAINT "projects_visibility_check" CHECK ("visibility" IN ('org', 'private')),
  CONSTRAINT "projects_key_check" CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,5}$'),
  CONSTRAINT "projects_dates_check" CHECK ("start_date" IS NULL OR "due_date" IS NULL OR "start_date" <= "due_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_key_live_unique" ON "pm"."projects" ("org_id", "key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "pm"."projects" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "projects_space_idx" ON "pm"."projects" ("space_id");
--> statement-breakpoint
CREATE INDEX "projects_crm_item_idx" ON "pm"."projects" ("crm_item_id");
--> statement-breakpoint
CREATE INDEX "projects_crm_customer_idx" ON "pm"."projects" ("crm_customer_id");
--> statement-breakpoint
CREATE TABLE "pm"."project_members" (
  "project_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "role"       text NOT NULL DEFAULT 'editor',
  "added_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "project_members_role_check" CHECK ("role" IN ('owner', 'editor', 'commenter', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "pm"."project_members" ("org_id", "user_id");
--> statement-breakpoint
CREATE TABLE "pm"."statuses" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "category"   text NOT NULL,
  "color"      text NOT NULL DEFAULT 'gray',
  "position"   text NOT NULL,
  "wip_limit"  integer,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "statuses_category_check" CHECK ("category" IN ('todo', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT "statuses_wip_limit_check" CHECK ("wip_limit" IS NULL OR "wip_limit" > 0)
);
--> statement-breakpoint
CREATE INDEX "statuses_project_idx" ON "pm"."statuses" ("project_id");
--> statement-breakpoint
CREATE TABLE "pm"."sections" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "position"   text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "sections_project_idx" ON "pm"."sections" ("project_id");
--> statement-breakpoint
CREATE TABLE "pm"."milestones" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"   uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"         text NOT NULL,
  "description"  text,
  "due_date"     date,
  "completed_at" timestamptz,
  "position"     text NOT NULL,
  "created_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "deleted_at"   timestamptz
);
--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "pm"."milestones" ("project_id");
--> statement-breakpoint
CREATE TABLE "pm"."labels" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "color"      text NOT NULL DEFAULT 'gray',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "labels_org_project_idx" ON "pm"."labels" ("org_id", "project_id");
--> statement-breakpoint
CREATE TABLE "pm"."custom_fields" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"  uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "type"        text NOT NULL,
  "config"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "description" text,
  "required"    boolean NOT NULL DEFAULT false,
  "position"    text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "deleted_at"  timestamptz,
  CONSTRAINT "custom_fields_type_check" CHECK ("type" IN ('text', 'number', 'select', 'multiselect', 'date', 'person', 'checkbox', 'currency', 'url'))
);
--> statement-breakpoint
CREATE INDEX "custom_fields_org_project_idx" ON "pm"."custom_fields" ("org_id", "project_id");
--> statement-breakpoint
CREATE TABLE "pm"."tasks" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"       uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "number"           integer NOT NULL,
  "title"            text NOT NULL,
  "description"      text,
  "status_id"        uuid NOT NULL REFERENCES "pm"."statuses"("id") ON DELETE RESTRICT,
  "section_id"       uuid REFERENCES "pm"."sections"("id") ON DELETE SET NULL,
  "priority"         text NOT NULL DEFAULT 'none',
  "assignee_id"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reporter_id"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "start_date"       date,
  "due_date"         date,
  "estimate_points"  integer,
  "estimate_minutes" integer,
  "parent_task_id"   uuid REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "position"         text NOT NULL,
  "is_milestone"     boolean NOT NULL DEFAULT false,
  "milestone_id"     uuid REFERENCES "pm"."milestones"("id") ON DELETE SET NULL,
  "custom_fields"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recurrence"       jsonb,
  "completed_at"     timestamptz,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "deleted_at"       timestamptz,
  "search"           tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce(regexp_replace("description", '<[^>]+>', ' ', 'g'), ''))
  ) STORED,
  CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('urgent', 'high', 'medium', 'low', 'none')),
  CONSTRAINT "tasks_estimate_check" CHECK (("estimate_points" IS NULL OR "estimate_points" >= 0) AND ("estimate_minutes" IS NULL OR "estimate_minutes" >= 0)),
  CONSTRAINT "tasks_not_own_parent_check" CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_number_unique" ON "pm"."tasks" ("project_id", "number");
--> statement-breakpoint
CREATE INDEX "tasks_project_live_idx" ON "pm"."tasks" ("project_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "pm"."tasks" ("org_id", "assignee_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "pm"."tasks" ("status_id");
--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "pm"."tasks" ("parent_task_id");
--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "pm"."tasks" ("org_id", "due_date");
--> statement-breakpoint
CREATE INDEX "tasks_search_idx" ON "pm"."tasks" USING gin ("search");
--> statement-breakpoint
CREATE TABLE "pm"."task_labels" (
  "task_id"    uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "label_id"   uuid NOT NULL REFERENCES "pm"."labels"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "task_labels_pkey" PRIMARY KEY ("task_id", "label_id")
);
--> statement-breakpoint
CREATE INDEX "task_labels_label_idx" ON "pm"."task_labels" ("label_id");
--> statement-breakpoint
CREATE TABLE "pm"."task_dependencies" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "blocking_task_id" uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "blocked_task_id"  uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "kind"             text NOT NULL DEFAULT 'finish_to_start',
  "lag_days"         integer NOT NULL DEFAULT 0,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "task_dependencies_pair_unique" UNIQUE ("blocking_task_id", "blocked_task_id"),
  CONSTRAINT "task_dependencies_not_self_check" CHECK ("blocking_task_id" <> "blocked_task_id"),
  CONSTRAINT "task_dependencies_kind_check" CHECK ("kind" IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'))
);
--> statement-breakpoint
CREATE INDEX "task_dependencies_blocked_idx" ON "pm"."task_dependencies" ("blocked_task_id");
--> statement-breakpoint
CREATE TABLE "pm"."watchers" (
  "task_id"    uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "watchers_pkey" PRIMARY KEY ("task_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "watchers_user_idx" ON "pm"."watchers" ("user_id");
--> statement-breakpoint
CREATE TABLE "pm"."comments" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"        uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "task_id"           uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "parent_comment_id" uuid REFERENCES "pm"."comments"("id") ON DELETE CASCADE,
  "author_id"         uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "body"              text NOT NULL,
  "mentions"          uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "reactions"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "edited_at"         timestamptz,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  "deleted_at"        timestamptz
);
--> statement-breakpoint
CREATE INDEX "comments_task_idx" ON "pm"."comments" ("task_id", "created_at");
--> statement-breakpoint
CREATE TABLE "pm"."attachments" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"   uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "task_id"      uuid REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "comment_id"   uuid REFERENCES "pm"."comments"("id") ON DELETE SET NULL,
  "name"         text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes"   integer NOT NULL,
  "storage"      text NOT NULL,
  "storage_key"  text,
  "data"         bytea,
  "uploaded_by"  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "deleted_at"   timestamptz,
  CONSTRAINT "attachments_storage_check" CHECK ("storage" IN ('db', 'disk', 'blob')),
  CONSTRAINT "attachments_size_check" CHECK ("size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX "attachments_task_idx" ON "pm"."attachments" ("task_id");
--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "pm"."attachments" ("project_id", "created_at");
--> statement-breakpoint
CREATE TABLE "pm"."activity" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"  uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "task_id"     uuid REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "actor_id"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "actor_kind"  text NOT NULL DEFAULT 'user',
  "verb"        text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id"   uuid,
  "field"       text,
  "before"      jsonb,
  "after"       jsonb,
  "meta"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "activity_actor_kind_check" CHECK ("actor_kind" IN ('user', 'automation', 'system', 'integration'))
);
--> statement-breakpoint
CREATE INDEX "activity_project_idx" ON "pm"."activity" ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX "activity_task_idx" ON "pm"."activity" ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "activity_org_idx" ON "pm"."activity" ("org_id", "created_at");
--> statement-breakpoint
CREATE INDEX "activity_actor_idx" ON "pm"."activity" ("actor_id", "created_at");
--> statement-breakpoint
-- The activity log is append-only. The one permitted update is the FK clearing actor_id
-- (ON DELETE SET NULL) when a user account is deleted.
CREATE OR REPLACE FUNCTION "pm"."activity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."actor_id" IS NULL AND OLD."actor_id" IS NOT NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'pm.activity is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER "activity_no_update" BEFORE UPDATE ON "pm"."activity"
  FOR EACH ROW EXECUTE FUNCTION "pm"."activity_immutable"();
--> statement-breakpoint
CREATE TABLE "pm"."time_entries" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"       uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "task_id"          uuid NOT NULL REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "user_id"          uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "started_at"       timestamptz NOT NULL,
  "ended_at"         timestamptz,
  "duration_minutes" integer,
  "note"             text,
  "billable"         boolean NOT NULL DEFAULT false,
  "source"           text NOT NULL DEFAULT 'timer',
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "deleted_at"       timestamptz,
  CONSTRAINT "time_entries_source_check" CHECK ("source" IN ('timer', 'manual')),
  CONSTRAINT "time_entries_duration_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0),
  CONSTRAINT "time_entries_range_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "pm"."time_entries" ("task_id");
--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "pm"."time_entries" ("org_id", "user_id", "started_at");
--> statement-breakpoint
-- At most one running timer per person.
CREATE UNIQUE INDEX "time_entries_one_running_unique" ON "pm"."time_entries" ("user_id")
  WHERE "ended_at" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "pm"."notifications" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"     uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "actor_id"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "kind"        text NOT NULL,
  "project_id"  uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "task_id"     uuid REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "comment_id"  uuid REFERENCES "pm"."comments"("id") ON DELETE CASCADE,
  "title"       text NOT NULL,
  "body"        text,
  "url"         text,
  "read_at"     timestamptz,
  "archived_at" timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('mention', 'assigned', 'comment', 'status_changed', 'due_soon', 'overdue', 'watching', 'automation', 'integration', 'project'))
);
--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "pm"."notifications" ("org_id", "user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "pm"."notifications" ("org_id", "user_id")
  WHERE "read_at" IS NULL AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "pm"."goals" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "parent_goal_id"  uuid REFERENCES "pm"."goals"("id") ON DELETE SET NULL,
  "name"            text NOT NULL,
  "description"     text,
  "owner_id"        uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "period"          text,
  "start_date"      date,
  "due_date"        date,
  "health"          text NOT NULL DEFAULT 'on_track',
  "progress_mode"   text NOT NULL DEFAULT 'key_results',
  "manual_progress" integer NOT NULL DEFAULT 0,
  "color"           text NOT NULL DEFAULT 'blue',
  "position"        text NOT NULL,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"      timestamptz,
  CONSTRAINT "goals_health_check" CHECK ("health" IN ('on_track', 'at_risk', 'off_track', 'achieved', 'missed')),
  CONSTRAINT "goals_progress_mode_check" CHECK ("progress_mode" IN ('key_results', 'projects', 'manual')),
  CONSTRAINT "goals_manual_progress_check" CHECK ("manual_progress" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE INDEX "goals_org_idx" ON "pm"."goals" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "pm"."goal_key_results" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "goal_id"       uuid NOT NULL REFERENCES "pm"."goals"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "kind"          text NOT NULL DEFAULT 'number',
  "start_value"   double precision NOT NULL DEFAULT 0,
  "target_value"  double precision NOT NULL DEFAULT 100,
  "current_value" double precision NOT NULL DEFAULT 0,
  "unit"          text,
  "project_id"    uuid REFERENCES "pm"."projects"("id") ON DELETE SET NULL,
  "position"      text NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_key_results_kind_check" CHECK ("kind" IN ('number', 'percent', 'currency', 'boolean', 'project'))
);
--> statement-breakpoint
CREATE INDEX "goal_key_results_goal_idx" ON "pm"."goal_key_results" ("goal_id");
--> statement-breakpoint
CREATE TABLE "pm"."goal_projects" (
  "goal_id"    uuid NOT NULL REFERENCES "pm"."goals"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_projects_pkey" PRIMARY KEY ("goal_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX "goal_projects_project_idx" ON "pm"."goal_projects" ("project_id");
--> statement-breakpoint
CREATE TABLE "pm"."saved_views" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "user_id"    uuid REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "type"       text NOT NULL,
  "config"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "position"   text NOT NULL,
  "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "saved_views_type_check" CHECK ("type" IN ('board', 'list', 'table', 'timeline', 'calendar', 'workload'))
);
--> statement-breakpoint
CREATE INDEX "saved_views_project_idx" ON "pm"."saved_views" ("org_id", "project_id");
--> statement-breakpoint
CREATE TABLE "pm"."dashboards" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"  uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "description" text,
  "widgets"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "filters"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "position"    text NOT NULL,
  "created_by"  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "deleted_at"  timestamptz
);
--> statement-breakpoint
CREATE INDEX "dashboards_org_idx" ON "pm"."dashboards" ("org_id");
--> statement-breakpoint
CREATE TABLE "pm"."automations" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"  uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "description" text,
  "enabled"     boolean NOT NULL DEFAULT true,
  "trigger"     jsonb NOT NULL,
  "conditions"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "actions"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "run_count"   integer NOT NULL DEFAULT 0,
  "last_run_at" timestamptz,
  "created_by"  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "deleted_at"  timestamptz
);
--> statement-breakpoint
CREATE INDEX "automations_org_project_idx" ON "pm"."automations" ("org_id", "project_id");
--> statement-breakpoint
CREATE TABLE "pm"."automation_runs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "automation_id" uuid NOT NULL REFERENCES "pm"."automations"("id") ON DELETE CASCADE,
  "task_id"       uuid REFERENCES "pm"."tasks"("id") ON DELETE SET NULL,
  "status"        text NOT NULL,
  "summary"       text,
  "detail"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "automation_runs_status_check" CHECK ("status" IN ('success', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "pm"."automation_runs" ("automation_id", "created_at");
--> statement-breakpoint
CREATE TABLE "pm"."templates" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"              text NOT NULL,
  "description"       text,
  "category"          text NOT NULL DEFAULT 'General',
  "icon"              text NOT NULL DEFAULT 'layout-template',
  "color"             text NOT NULL DEFAULT 'blue',
  "payload"           jsonb NOT NULL,
  "source_project_id" uuid REFERENCES "pm"."projects"("id") ON DELETE SET NULL,
  "use_count"         integer NOT NULL DEFAULT 0,
  "created_by"        uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  "deleted_at"        timestamptz
);
--> statement-breakpoint
CREATE INDEX "templates_org_idx" ON "pm"."templates" ("org_id");
--> statement-breakpoint
CREATE TABLE "pm"."forms" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"       uuid NOT NULL REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "name"             text NOT NULL,
  "description"      text,
  "fields"           jsonb NOT NULL DEFAULT '[]'::jsonb,
  "settings"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_public"        boolean NOT NULL DEFAULT true,
  "enabled"          boolean NOT NULL DEFAULT true,
  "public_token"     text NOT NULL,
  "submission_count" integer NOT NULL DEFAULT 0,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "deleted_at"       timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "forms_public_token_unique" ON "pm"."forms" ("public_token");
--> statement-breakpoint
CREATE INDEX "forms_project_idx" ON "pm"."forms" ("project_id");
--> statement-breakpoint
CREATE TABLE "pm"."form_submissions" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "form_id"         uuid NOT NULL REFERENCES "pm"."forms"("id") ON DELETE CASCADE,
  "task_id"         uuid REFERENCES "pm"."tasks"("id") ON DELETE SET NULL,
  "data"            jsonb NOT NULL,
  "submitter_name"  text,
  "submitter_email" text,
  "submitted_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "pm"."form_submissions" ("form_id", "created_at");
--> statement-breakpoint
CREATE TABLE "pm"."integration_links" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "project_id"    uuid REFERENCES "pm"."projects"("id") ON DELETE CASCADE,
  "task_id"       uuid REFERENCES "pm"."tasks"("id") ON DELETE CASCADE,
  "target_type"   text NOT NULL,
  "target_id"     text NOT NULL,
  "cached_title"  text,
  "cached_status" text,
  "cached_url"    text,
  "cached_at"     timestamptz,
  "meta"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_links_owner_check" CHECK (("project_id" IS NULL) <> ("task_id" IS NULL)),
  CONSTRAINT "integration_links_target_type_check" CHECK ("target_type" IN ('crm_item', 'crm_account', 'core_customer', 'wms_order', 'wms_work_order', 'wms_receipt', 'wms_count'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_links_task_target_unique" ON "pm"."integration_links" ("task_id", "target_type", "target_id") WHERE "task_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_links_project_target_unique" ON "pm"."integration_links" ("project_id", "target_type", "target_id") WHERE "project_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "integration_links_target_idx" ON "pm"."integration_links" ("org_id", "target_type", "target_id");
--> statement-breakpoint
-- RLS on every pm table (no policies: only the app's server role, which owns the tables, reads them).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'pm' LOOP
    EXECUTE format('ALTER TABLE "pm".%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
