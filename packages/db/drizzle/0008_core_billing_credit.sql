/*
 * 0008_core_billing_credit: review round 1 fixes for signup and billing (docs/billing/CONTRACTS.md
 * section 24).
 *
 * 1. core.billing_subscriptions learns the customer's credit balance and what the next bill will
 *    really charge the card (after a promo code and after credit), so every screen can show the
 *    same number the gateway will charge.
 * 2. core.billing_invoices learns how much credit paid an invoice and how much was sent back.
 * 3. A trigger on core.member removes the billing manager row of a person who leaves, is removed or
 *    is deactivated, at every door (Portal, CRM, WMS, Projects, Pulse, plain SQL), and writes one
 *    activity line. The role can never come back by itself when the person is invited again.
 *
 * Safe to run again: every statement is IF NOT EXISTS, OR REPLACE or guarded.
 */
ALTER TABLE "core"."billing_subscriptions"
  ADD COLUMN IF NOT EXISTS "credit_cents"        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_charge_cents"   integer,
  ADD COLUMN IF NOT EXISTS "next_discount_cents" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_discount_label" text,
  ADD COLUMN IF NOT EXISTS "next_credit_cents"   integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "core"."billing_invoices"
  ADD COLUMN IF NOT EXISTS "credit_applied_cents" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_cents"       integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "core"."billing_manager_cleanup"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  person_name text;
  why text;
BEGIN
  DELETE FROM "core"."billing_managers"
   WHERE "org_id" = OLD."organization_id" AND "user_id" = OLD."user_id";
  IF FOUND AND EXISTS (SELECT 1 FROM "core"."organization" WHERE "id" = OLD."organization_id") THEN
    SELECT "name" INTO person_name FROM "core"."user" WHERE "id" = OLD."user_id";
    why := CASE WHEN TG_OP = 'DELETE' THEN 'left the organization' ELSE 'was deactivated' END;
    INSERT INTO "core"."billing_audit_log" ("org_id", "actor_label", "action", "summary", "data")
    VALUES (
      OLD."organization_id",
      'KitStak',
      'manager.removed',
      COALESCE(NULLIF(btrim(person_name), ''), 'A person') || ' ' || why || ' and is no longer a billing manager.',
      jsonb_build_object('userId', OLD."user_id", 'reason', CASE WHEN TG_OP = 'DELETE' THEN 'member_removed' ELSE 'member_deactivated' END)
    );
  END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.member') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "billing_manager_cleanup_on_delete" ON "core"."member";
    CREATE TRIGGER "billing_manager_cleanup_on_delete"
      AFTER DELETE ON "core"."member"
      FOR EACH ROW EXECUTE FUNCTION "core"."billing_manager_cleanup"();
    DROP TRIGGER IF EXISTS "billing_manager_cleanup_on_deactivate" ON "core"."member";
    CREATE TRIGGER "billing_manager_cleanup_on_deactivate"
      AFTER UPDATE OF "role" ON "core"."member"
      FOR EACH ROW
      WHEN (lower(btrim(NEW."role")) LIKE 'deactivated:%' AND lower(btrim(OLD."role")) NOT LIKE 'deactivated:%')
      EXECUTE FUNCTION "core"."billing_manager_cleanup"();
  END IF;
END $$;
--> statement-breakpoint
/* Rows left behind before this trigger existed: managers who are no longer active members. */
DO $$
BEGIN
  IF to_regclass('core.member') IS NOT NULL THEN
    DELETE FROM "core"."billing_managers" bm
     WHERE NOT EXISTS (
       SELECT 1 FROM "core"."member" m
        WHERE m."organization_id" = bm."org_id" AND m."user_id" = bm."user_id"
          AND lower(btrim(m."role")) NOT LIKE 'deactivated:%'
     );
  END IF;
END $$;
