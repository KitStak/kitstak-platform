/*
 * 0012_core_api_tokens: platform API tokens (docs/integration/AGENT_WRITE_API.md, W1 to W6).
 *
 * core.api_tokens: one personal token, made and revoked in Portal settings, that every app accepts
 * (`Authorization: Bearer ks_pat_...`). Only the SHA-256 hash of the token is stored; the token is
 * shown once when it is made. A token belongs to one person in one organization, carries app scopes
 * (`crm:read`, `projects:write` and so on), always expires (at most 90 days after it is made), and
 * can be revoked at once. It never grants more than its owner's own role in each app.
 *
 * core.api_token_events: one row per write an app accepted or refused for a token, so people can
 * see what was done with it. Written by the apps' agent endpoints (later steps of the plan).
 *
 * CRM's own `crm.api_tokens` (`ks_live_...`) is not touched.
 *
 * Triggers (end of file): the 20 live token limit per person per organization, and revoking a
 * person's tokens for good when they leave, are deactivated or are switched off.
 *
 * Safe to run again: every statement is IF NOT EXISTS or guarded. Foreign keys to core.organization
 * and core."user" are guarded on the target tables, like 0009_core_billing_locks.sql.
 */
CREATE TABLE IF NOT EXISTS "core"."api_tokens" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL,
  "user_id"      uuid NOT NULL,
  "name"         text NOT NULL,
  "token_hash"   text NOT NULL,
  "token_prefix" text NOT NULL,
  "scopes"       text[] NOT NULL,
  "expires_at"   timestamptz NOT NULL,
  "revoked_at"   timestamptz,
  "revoked_by"   uuid,
  "last_used_at" timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "api_tokens_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "api_tokens_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "api_tokens_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_tokens_scopes_check" CHECK (
    cardinality("scopes") BETWEEN 1 AND 12
    AND "scopes" <@ ARRAY['crm:read','crm:write','projects:read','projects:write','pulse:read','pulse:write']::text[]
  ),
  CONSTRAINT "api_tokens_expires_check" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '90 days 1 minute')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_tokens_org_user_idx" ON "core"."api_tokens" ("org_id", "user_id");
--> statement-breakpoint
ALTER TABLE "core"."api_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."api_token_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_id"   uuid NOT NULL REFERENCES "core"."api_tokens"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL,
  "app"        text NOT NULL,
  "action"     text NOT NULL,
  "dry_run"    boolean NOT NULL DEFAULT false,
  "ok"         boolean NOT NULL,
  "error_code" text,
  "target"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "api_token_events_app_check" CHECK ("app" IN ('crm', 'projects', 'pulse')),
  CONSTRAINT "api_token_events_action_check" CHECK (char_length("action") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_token_events_token_at_idx" ON "core"."api_token_events" ("token_id", "at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_token_events_org_at_idx" ON "core"."api_token_events" ("org_id", "at" DESC);
--> statement-breakpoint
ALTER TABLE "core"."api_token_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."api_tokens" ADD CONSTRAINT "api_tokens_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_token_events_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."api_token_events" ADD CONSTRAINT "api_token_events_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
  END IF;
  IF to_regclass('core."user"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_user_id_user_id_fk') THEN
      ALTER TABLE "core"."api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
/*
 * The live token limit (20 per person per organization), enforced here so two requests at the same
 * moment cannot both make the 20th: the lock serializes inserts for one person, and in a VOLATILE
 * plpgsql function the count sees rows committed by the request that held the lock first.
 */
CREATE OR REPLACE FUNCTION "core"."api_tokens_live_limit"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  live integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('core.api_tokens:' || NEW."org_id"::text || ':' || NEW."user_id"::text));
  SELECT count(*) INTO live FROM "core"."api_tokens"
   WHERE "org_id" = NEW."org_id" AND "user_id" = NEW."user_id" AND "revoked_at" IS NULL AND "expires_at" > now();
  IF live >= 20 THEN
    RAISE EXCEPTION 'A person can hold at most 20 live API tokens in one organization.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'api_tokens_live_limit';
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "api_tokens_live_limit" ON "core"."api_tokens";
--> statement-breakpoint
CREATE TRIGGER "api_tokens_live_limit"
  BEFORE INSERT ON "core"."api_tokens"
  FOR EACH ROW EXECUTE FUNCTION "core"."api_tokens_live_limit"();
--> statement-breakpoint
/*
 * A token dies for good when its owner leaves the organization, is deactivated in it, or is switched
 * off everywhere (core.sign_in_blocks). Revoking (not just failing the check) means re-inviting or
 * reactivating the person never brings an old, possibly leaked, token back. Done in the database so
 * every app's way of removing or deactivating a person is covered. `revoked_by` stays NULL: the
 * system did it.
 */
CREATE OR REPLACE FUNCTION "core"."api_tokens_revoke_for_member"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE "core"."api_tokens" SET "revoked_at" = now()
   WHERE "org_id" = OLD."organization_id" AND "user_id" = OLD."user_id" AND "revoked_at" IS NULL;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "core"."api_tokens_revoke_for_block"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE "core"."api_tokens" SET "revoked_at" = now()
   WHERE "user_id" = NEW."user_id" AND "revoked_at" IS NULL;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.member') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "api_tokens_revoke_on_member_delete" ON "core"."member";
    CREATE TRIGGER "api_tokens_revoke_on_member_delete"
      AFTER DELETE ON "core"."member"
      FOR EACH ROW EXECUTE FUNCTION "core"."api_tokens_revoke_for_member"();
    DROP TRIGGER IF EXISTS "api_tokens_revoke_on_member_deactivate" ON "core"."member";
    CREATE TRIGGER "api_tokens_revoke_on_member_deactivate"
      AFTER UPDATE OF "role" ON "core"."member"
      FOR EACH ROW
      WHEN (lower(btrim(NEW."role")) LIKE 'deactivated:%' AND lower(btrim(OLD."role")) NOT LIKE 'deactivated:%')
      EXECUTE FUNCTION "core"."api_tokens_revoke_for_member"();
  END IF;
  IF to_regclass('core.sign_in_blocks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "api_tokens_revoke_on_sign_in_block" ON "core"."sign_in_blocks";
    CREATE TRIGGER "api_tokens_revoke_on_sign_in_block"
      AFTER INSERT ON "core"."sign_in_blocks"
      FOR EACH ROW EXECUTE FUNCTION "core"."api_tokens_revoke_for_block"();
  END IF;
END $$;
