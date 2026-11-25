/*
 * 0010_core_billing_round3: review round 3 for signup and billing (docs/billing/CONTRACTS.md
 * section 26).
 *
 * 1. core.billing_subscriptions learns WHY a plan ended, so the "Your plan has ended" email, billing
 *    home and the activity line can say it: the customer canceled, the customer canceled with a bill
 *    still open (the plan ended that day and the bill was dropped), or the gateway gave up after the
 *    last failed try (with the amount and the number of tries).
 *
 * 2. core.billing_stamps: one small row per organization with a number that goes up on every billing
 *    write. Each product app keeps the plan of an organization in memory for up to 60 seconds. Before
 *    it trusts that copy it reads this one number (one primary key lookup). A different number means
 *    something changed, and the copy is read again. So a cancel, a "Keep my plan", a pause or a
 *    payment made in the Portal shows in the CRM, WMS, Projects and Pulse on the very next page.
 *
 *    The number is bumped by triggers, not by application code, so no writer can forget it: the
 *    billing sync, the test tools, the manual grant script and plain SQL all count.
 *
 * Safe to run again: every statement is IF NOT EXISTS, OR REPLACE or guarded.
 */
ALTER TABLE "core"."billing_subscriptions"
  ADD COLUMN IF NOT EXISTS "ended_reason"       text,
  ADD COLUMN IF NOT EXISTS "ended_amount_cents" integer,
  ADD COLUMN IF NOT EXISTS "ended_attempts"     integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_subscriptions_ended_reason_check') THEN
    ALTER TABLE "core"."billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_ended_reason_check"
      CHECK ("ended_reason" IS NULL OR "ended_reason" IN ('canceled', 'canceled_unpaid', 'payment_failed'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_stamps" (
  "org_id"     uuid PRIMARY KEY,
  "version"    bigint NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "core"."billing_stamps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
/*
 * No foreign key to core.organization on purpose: when an organization is deleted, its billing rows
 * go with it, and each of those deletes fires the trigger below. A stamp row is one number and is
 * removed by the cleanup trigger further down.
 */
CREATE OR REPLACE FUNCTION "core"."billing_stamp_bump"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target := OLD."org_id";
  ELSE
    target := NEW."org_id";
  END IF;
  IF target IS NOT NULL THEN
    INSERT INTO "core"."billing_stamps" ("org_id", "version", "updated_at")
    VALUES (target, 1, now())
    ON CONFLICT ("org_id") DO UPDATE
      SET "version" = "core"."billing_stamps"."version" + 1, "updated_at" = now();
  END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
DO $$
DECLARE
  watched text;
BEGIN
  FOREACH watched IN ARRAY ARRAY['entitlements', 'billing_subscriptions', 'billing_accounts', 'billing_managers'] LOOP
    IF to_regclass('core.' || watched) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS "billing_stamp_bump" ON "core".%I', watched);
      EXECUTE format(
        'CREATE TRIGGER "billing_stamp_bump" AFTER INSERT OR UPDATE OR DELETE ON "core".%I
           FOR EACH ROW EXECUTE FUNCTION "core"."billing_stamp_bump"()',
        watched
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "core"."billing_stamp_cleanup"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM "core"."billing_stamps" WHERE "org_id" = OLD."id";
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "billing_stamp_cleanup" ON "core"."organization";
    /* Deferred to the end of the transaction, after everything that cascades from the row is gone. */
    CREATE CONSTRAINT TRIGGER "billing_stamp_cleanup"
      AFTER DELETE ON "core"."organization"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "core"."billing_stamp_cleanup"();
  END IF;
END $$;
--> statement-breakpoint
/* Every organization that already has billing rows starts with a stamp, so the first read finds one. */
INSERT INTO "core"."billing_stamps" ("org_id")
SELECT DISTINCT "org_id" FROM (
  SELECT "org_id" FROM "core"."entitlements"
  UNION SELECT "org_id" FROM "core"."billing_subscriptions"
  UNION SELECT "org_id" FROM "core"."billing_accounts"
) AS seen
WHERE "org_id" IS NOT NULL
ON CONFLICT ("org_id") DO NOTHING;
