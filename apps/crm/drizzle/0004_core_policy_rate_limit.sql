-- 0004_core_policy_rate_limit — shared auth security state for the CRM instance
-- (auth review 2026-11-11, H1 + M4).
--
-- H1: the password-policy/lockout plugin is now mounted by the shared @kitstak/auth
-- factory on EVERY instance, so CRM's database (embedded dev Postgres included) needs
-- core.password_policy_state. DDL mirrors apps/wms/drizzle/0007_core_auth.sql exactly;
-- IF NOT EXISTS because the shared platform database may already have it from WMS.
--
-- M4: core.rate_limit backs Better Auth's `rateLimit.storage: 'database'` (durable,
-- cross-instance counters). DDL mirrors apps/wms/drizzle/0008_core_rate_limit.sql.
-- RLS: deny-by-default (enabled, no policies) — the app connects as the table owner.
CREATE SCHEMA IF NOT EXISTS "core";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."password_policy_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	CONSTRAINT "password_policy_state_email_unique" UNIQUE("email")
);--> statement-breakpoint
ALTER TABLE "core"."password_policy_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);--> statement-breakpoint
ALTER TABLE "core"."rate_limit" ENABLE ROW LEVEL SECURITY;
