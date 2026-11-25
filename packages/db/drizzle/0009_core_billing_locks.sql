/*
 * 0009_core_billing_locks: review round 2 for signup and billing (docs/billing/CONTRACTS.md
 * section 25).
 *
 * core.billing_locks: one row per organization while a person's billing step that talks to the
 * gateway is running (opening checkout, confirming a plan change). The row is a lease: it names its
 * holder and ends by itself, so a server that dies in the middle cannot block an organization for
 * good. It holds no database connection while the gateway is asked, which is why this is a row and
 * not an advisory lock (the webhook path keeps its short advisory lock inside one transaction).
 *
 * Safe to run again: every statement is IF NOT EXISTS or guarded. The foreign key to
 * core.organization is guarded on the target table, like 0007_core_billing.sql.
 */
CREATE TABLE IF NOT EXISTS "core"."billing_locks" (
  "org_id"     uuid PRIMARY KEY,
  "holder"     text NOT NULL,
  "purpose"    text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "core"."billing_locks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_locks_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_locks" ADD CONSTRAINT "billing_locks_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
