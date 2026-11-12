-- Move every CRM domain table created by 0000_init into the `crm` Postgres schema.
-- Auth tables (user, session, account, verification, organization, member, invitation,
-- team, team_member) stay in `public` this phase; they move to `core` in Phase 3.
-- pg enums created by 0000 (workspace_kind, board_kind, column_type, ...) stay in
-- `public` deliberately: moved tables keep referencing them across schemas.
-- `ALTER TABLE ... SET SCHEMA` carries indexes, constraints and sequences with the table.
CREATE SCHEMA IF NOT EXISTS "crm";--> statement-breakpoint
ALTER TABLE "public"."workspaces" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."workspace_members" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."folders" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."boards" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."board_members" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."columns" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."groups" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."items" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."item_links" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."views" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."updates" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."update_reactions" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."update_reads" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."files" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."activity_log" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."notifications" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."dashboards" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."dashboard_widgets" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."automations" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."automation_runs" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."favorites" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."recent_visits" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."saved_filters" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."api_tokens" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."audit_log" SET SCHEMA "crm";--> statement-breakpoint
ALTER TABLE "public"."webhooks" SET SCHEMA "crm";
