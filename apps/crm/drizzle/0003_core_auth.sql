-- Relocate the 9 Better Auth tables from `public` into the shared `core` schema
-- (BLUEPRINT.md §1.3/§2.1, Phase 3). `ALTER TABLE ... SET SCHEMA` carries indexes,
-- constraints, sequences AND incoming foreign keys (crm.* tables reference these by
-- OID, not by name), so nothing else needs re-qualifying: the auth indexes from
-- 0000_init (session_userId_idx, account_userId_idx, verification_identifier_idx,
-- team_organizationId_idx, teamMember_*_idx, member_*_idx, invitation_*_idx) and the
-- unique constraints (user_email_unique, session_token_unique, organization_slug_unique,
-- team_member_membership_key_unique) all move with their tables. 0001_search_indexes
-- touches only crm domain tables.
CREATE SCHEMA IF NOT EXISTS "core";--> statement-breakpoint
ALTER TABLE "public"."user" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."session" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."account" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."verification" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."organization" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."member" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."team" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."team_member" SET SCHEMA "core";--> statement-breakpoint
ALTER TABLE "public"."invitation" SET SCHEMA "core";
