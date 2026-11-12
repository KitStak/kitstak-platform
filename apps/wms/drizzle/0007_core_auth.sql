-- 0007_core_auth — shared Better Auth tables for WMS (BLUEPRINT.md §1.4, Phase 4).
--
-- WMS now authenticates through the shared Better Auth instance (@kitstak/auth), whose
-- tables live in the `core` schema. On a WMS-local dev database (PGlite / own Postgres)
-- nothing has created them yet, so this migration builds them from scratch; on the shared
-- platform database CRM's migrations 0000_init + 0003_core_auth already created/relocated
-- them, so every statement here is guarded (IF NOT EXISTS / pg_constraint checks) and the
-- whole file is a no-op there. DDL shape = CRM 0000_init auth tables relocated to `core`
-- (apps/crm/drizzle/0003_core_auth.sql outcome), plus the password-policy plugin's
-- core.password_policy_state and wms.user_profiles (packages/db 0000_core_init shape).
-- RLS: deny-by-default (enabled, no policies) — the app connects as the table owner.
CREATE SCHEMA IF NOT EXISTS "core";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"title" text,
	"timezone" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" text,
	"active_team_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."organization" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."member" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."team" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."team_member" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_key" text,
	"created_at" timestamp,
	CONSTRAINT "team_member_membership_key_unique" UNIQUE("membership_key")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."invitation" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);--> statement-breakpoint
-- Lockout state for @kitstak/auth passwordPolicyPlugin (packages/db schema/core/auth-policy.ts).
CREATE TABLE IF NOT EXISTS "core"."password_policy_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	CONSTRAINT "password_policy_state_email_unique" UNIQUE("email")
);--> statement-breakpoint
-- WMS user profile extension (BLUEPRINT.md §2.3; same shape as packages/db 0000_core_init).
CREATE TABLE IF NOT EXISTS "wms"."user_profiles" (
	"user_id"             uuid PRIMARY KEY,
	"legacy_role"         text NOT NULL DEFAULT 'viewer',
	"user_type"           text NOT NULL DEFAULT 'Operation',
	"is_api_user"         boolean NOT NULL DEFAULT false,
	"all_clients"         boolean NOT NULL DEFAULT true,
	"preferences"         jsonb NOT NULL DEFAULT '{}'::jsonb,
	"password_changed_at" timestamptz,
	"last_login_at"       timestamptz
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_user_id_user_id_fk') THEN
    ALTER TABLE "core"."session" ADD CONSTRAINT "session_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_user_id_user_id_fk') THEN
    ALTER TABLE "core"."account" ADD CONSTRAINT "account_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_organization_id_organization_id_fk') THEN
    ALTER TABLE "core"."member" ADD CONSTRAINT "member_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_user_id_user_id_fk') THEN
    ALTER TABLE "core"."member" ADD CONSTRAINT "member_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_organization_id_organization_id_fk') THEN
    ALTER TABLE "core"."team" ADD CONSTRAINT "team_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_member_team_id_team_id_fk') THEN
    ALTER TABLE "core"."team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk"
      FOREIGN KEY ("team_id") REFERENCES "core"."team"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_member_user_id_user_id_fk') THEN
    ALTER TABLE "core"."team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_organization_id_organization_id_fk') THEN
    ALTER TABLE "core"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_inviter_id_user_id_fk') THEN
    ALTER TABLE "core"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk"
      FOREIGN KEY ("inviter_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_user_id_user_id_fk') THEN
    ALTER TABLE "wms"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "core"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "core"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "core"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "core"."member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "core"."member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_organizationId_idx" ON "core"."team" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teamMember_teamId_idx" ON "core"."team_member" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teamMember_userId_idx" ON "core"."team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "core"."invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "core"."invitation" USING btree ("email");--> statement-breakpoint
ALTER TABLE "core"."user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."team_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."password_policy_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wms"."user_profiles" ENABLE ROW LEVEL SECURITY;
