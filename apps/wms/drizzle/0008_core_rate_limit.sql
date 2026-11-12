-- 0008_core_rate_limit — durable auth-path rate limiting (auth review 2026-11-11, M4).
--
-- @kitstak/auth's createAuth now sets Better Auth `rateLimit.storage: 'database'`
-- (adapter model `rateLimit` → packages/db schema/core/rate-limit.ts), replacing the
-- per-process memory counters that reset on every serverless cold start. IF NOT EXISTS
-- because the shared platform database may already have the table from CRM's 0004.
-- RLS: deny-by-default (enabled, no policies) — the app connects as the table owner.
CREATE TABLE IF NOT EXISTS "core"."rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);--> statement-breakpoint
ALTER TABLE "core"."rate_limit" ENABLE ROW LEVEL SECURITY;
