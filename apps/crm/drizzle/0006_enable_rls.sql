-- Deny-by-default RLS (BLUEPRINT.md §2.1): enable row level security with NO policies on
-- every core auth and crm table. The app connects as the table owner (postgres), which
-- bypasses RLS; PostgREST/anon roles see nothing even if these schemas are ever exposed.
-- Idempotent: ENABLE ROW LEVEL SECURITY on an already-enabled table is a no-op.
ALTER TABLE "core"."user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."team_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."boards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."board_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."columns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."item_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."update_reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."update_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."dashboards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."dashboard_widgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."recent_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."saved_filters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."webhooks" ENABLE ROW LEVEL SECURITY;
