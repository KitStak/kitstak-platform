/*
 * 0007_core_billing: signup and billing (docs/billing/CONTRACTS.md section 9).
 *
 * New tables: core.billing_accounts, billing_subscriptions, billing_invoices, billing_audit_log,
 * billing_managers, billing_cancel_feedback, billing_emails, billing_test_objects, billing_trial_uses
 * and core.signup_intents. core.billing_events (the webhook ledger) is widened. The module CHECK on
 * core.entitlements is set to all four apps again.
 *
 * Safe to run again: every statement is IF NOT EXISTS or guarded. Foreign keys to core.organization
 * and core."user" are guarded on the target tables, like 0002_core_onboarding.sql.
 */
CREATE TABLE IF NOT EXISTS "core"."billing_accounts" (
  "org_id"            uuid PRIMARY KEY,
  "gateway"           text,
  "cart"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "trial_started_at"  timestamptz,
  "trial_ends_at"     timestamptz,
  "trial_started_by"  uuid,
  "billing_email"     text,
  "company_name"      text,
  "address"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "tax_id_type"       text,
  "tax_id_value"      text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_accounts_gateway_check" CHECK ("gateway" IS NULL OR "gateway" IN ('stripe', 'test'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_accounts_trial_ends_idx"
  ON "core"."billing_accounts" ("trial_ends_at") WHERE "trial_ends_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_accounts_trial_started_by_idx"
  ON "core"."billing_accounts" ("trial_started_by") WHERE "trial_started_by" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_subscriptions" (
  "org_id"                  uuid PRIMARY KEY,
  "gateway"                 text NOT NULL,
  "gateway_subscription_id" text NOT NULL,
  "gateway_customer_id"     text NOT NULL,
  "status"                  text NOT NULL,
  "interval"                text NOT NULL,
  "seats"                   integer NOT NULL DEFAULT 1,
  "warehouses"              integer NOT NULL DEFAULT 1,
  "items"                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recurring_cents"         integer NOT NULL DEFAULT 0,
  "currency"                text NOT NULL DEFAULT 'usd',
  "current_period_start"    timestamptz,
  "current_period_end"      timestamptz,
  "trial_end"               timestamptz,
  "cancel_at_period_end"    boolean NOT NULL DEFAULT false,
  "cancel_at"               timestamptz,
  "canceled_at"             timestamptz,
  "ended_at"                timestamptz,
  "pause_starts_at"         timestamptz,
  "pause_resumes_at"        timestamptz,
  "past_due_since"          timestamptz,
  "amount_due_cents"        integer,
  "next_payment_attempt"    timestamptz,
  "last_payment_error"      text,
  "pm_brand"                text,
  "pm_last4"                text,
  "pm_exp_month"            integer,
  "pm_exp_year"             integer,
  "latest_invoice_id"       text,
  "gateway_synced_at"       timestamptz NOT NULL DEFAULT now(),
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_subscriptions_gateway_subscription_id_unique" UNIQUE ("gateway_subscription_id"),
  CONSTRAINT "billing_subscriptions_gateway_check" CHECK ("gateway" IN ('stripe', 'test')),
  CONSTRAINT "billing_subscriptions_status_check"
    CHECK ("status" IN ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')),
  CONSTRAINT "billing_subscriptions_interval_check" CHECK ("interval" IN ('monthly', 'yearly'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_invoices" (
  "id"                   text PRIMARY KEY,
  "org_id"               uuid NOT NULL,
  "gateway"              text NOT NULL,
  "number"               text,
  "status"               text NOT NULL,
  "billing_reason"       text,
  "currency"             text NOT NULL DEFAULT 'usd',
  "subtotal_cents"       integer NOT NULL DEFAULT 0,
  "discount_cents"       integer NOT NULL DEFAULT 0,
  "tax_cents"            integer NOT NULL DEFAULT 0,
  "total_cents"          integer NOT NULL DEFAULT 0,
  "amount_paid_cents"    integer NOT NULL DEFAULT 0,
  "amount_due_cents"     integer NOT NULL DEFAULT 0,
  "lines"                jsonb NOT NULL DEFAULT '[]'::jsonb,
  "period_start"         timestamptz,
  "period_end"           timestamptz,
  "issued_at"            timestamptz NOT NULL,
  "paid_at"              timestamptz,
  "attempt_count"        integer NOT NULL DEFAULT 0,
  "next_payment_attempt" timestamptz,
  "pm_last4"             text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_invoices_status_check"
    CHECK ("status" IN ('draft', 'open', 'paid', 'void', 'uncollectible'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_org_issued_idx"
  ON "core"."billing_invoices" ("org_id", "issued_at" DESC);
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "org_id" uuid;
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "gateway" text NOT NULL DEFAULT 'stripe';
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'processed';
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "error" text;
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "core"."billing_events" ADD COLUMN IF NOT EXISTS "received_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_status_check') THEN
    ALTER TABLE "core"."billing_events" ADD CONSTRAINT "billing_events_status_check"
      CHECK ("status" IN ('processed', 'ignored', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_gateway_check') THEN
    ALTER TABLE "core"."billing_events" ADD CONSTRAINT "billing_events_gateway_check"
      CHECK ("gateway" IN ('stripe', 'test'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_events_org_idx" ON "core"."billing_events" ("org_id", "received_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_audit_log" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL,
  "actor_user_id"  uuid,
  "actor_label"    text NOT NULL,
  "action"         text NOT NULL,
  "summary"        text NOT NULL,
  "data"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "event_id"       text,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_audit_log_org_created_idx"
  ON "core"."billing_audit_log" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_managers" (
  "org_id"     uuid NOT NULL,
  "user_id"    uuid NOT NULL,
  "added_by"   uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_managers_pkey" PRIMARY KEY ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_cancel_feedback" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL,
  "user_id"    uuid,
  "reason"     text,
  "detail"     text,
  "outcome"    text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_cancel_feedback_reason_check" CHECK ("reason" IS NULL OR "reason" IN
    ('too_expensive', 'missing_feature', 'switching_tool', 'not_using', 'seasonal', 'other')),
  CONSTRAINT "billing_cancel_feedback_outcome_check" CHECK ("outcome" IN ('canceled', 'paused', 'kept'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_cancel_feedback_org_idx"
  ON "core"."billing_cancel_feedback" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_emails" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid,
  "to_email"            text NOT NULL,
  "template"            text NOT NULL,
  "payload"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key"          text NOT NULL,
  "status"              text NOT NULL DEFAULT 'queued',
  "provider"            text,
  "provider_message_id" text,
  "subject"             text,
  "html"                text,
  "body_text"           text,
  "error"               text,
  "attempts"            integer NOT NULL DEFAULT 0,
  "send_after"          timestamptz NOT NULL DEFAULT now(),
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "sent_at"             timestamptz,
  CONSTRAINT "billing_emails_dedupe_key_unique" UNIQUE ("dedupe_key"),
  CONSTRAINT "billing_emails_status_check" CHECK ("status" IN ('queued', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_emails_queue_idx"
  ON "core"."billing_emails" ("send_after") WHERE "status" = 'queued';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."billing_test_objects" (
  "id"         text PRIMARY KEY,
  "kind"       text NOT NULL,
  "org_id"     uuid,
  "data"       jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_test_objects_kind_check"
    CHECK ("kind" IN ('customer', 'checkout_session', 'portal_session', 'subscription', 'invoice', 'payment_method'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_test_objects_org_kind_idx"
  ON "core"."billing_test_objects" ("org_id", "kind");
--> statement-breakpoint
/*
 * One row per person per organization whose free trial they started. It has no foreign key to the
 * organization on purpose: the row must outlive a deleted organization, so the rule "one free trial
 * per person" cannot be reset by deleting an organization and making a new one.
 */
CREATE TABLE IF NOT EXISTS "core"."billing_trial_uses" (
  "user_id"    uuid NOT NULL,
  "org_id"     uuid NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_trial_uses_pkey" PRIMARY KEY ("user_id", "org_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."signup_intents" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      uuid NOT NULL,
  "org_id"       uuid,
  "selection"    jsonb,
  "profile"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source"       text NOT NULL DEFAULT 'direct',
  "step"         text NOT NULL DEFAULT 'company',
  "verify_skipped_at" timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "signup_intents_step_check" CHECK ("step" IN ('company', 'plan', 'verify', 'welcome', 'done')),
  CONSTRAINT "signup_intents_source_check" CHECK ("source" IN ('wizard', 'pricing', 'product', 'app', 'direct', 'invite'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signup_intents_open_user_unique"
  ON "core"."signup_intents" ("user_id") WHERE "completed_at" IS NULL;
--> statement-breakpoint
/*
 * Foreign keys, guarded on the target tables (0001_core_fks pattern): these migrations may run before
 * the CRM migrations move the Better Auth tables into core. Rows that belong to an organization go
 * when it goes. A deleted person leaves history in place with the person column emptied, except
 * where the person is the key of the row.
 */
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_accounts_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_accounts" ADD CONSTRAINT "billing_accounts_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_subscriptions_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoices_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_invoices" ADD CONSTRAINT "billing_invoices_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_events" ADD CONSTRAINT "billing_events_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_audit_log_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_audit_log" ADD CONSTRAINT "billing_audit_log_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_managers_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_managers" ADD CONSTRAINT "billing_managers_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_cancel_feedback_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_cancel_feedback" ADD CONSTRAINT "billing_cancel_feedback_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_emails_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_emails" ADD CONSTRAINT "billing_emails_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_test_objects_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."billing_test_objects" ADD CONSTRAINT "billing_test_objects_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signup_intents_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."signup_intents" ADD CONSTRAINT "signup_intents_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE SET NULL;
    END IF;
  END IF;
  IF to_regclass('core."user"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_accounts_trial_started_by_user_id_fk') THEN
      ALTER TABLE "core"."billing_accounts" ADD CONSTRAINT "billing_accounts_trial_started_by_user_id_fk"
        FOREIGN KEY ("trial_started_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_audit_log_actor_user_id_user_id_fk') THEN
      ALTER TABLE "core"."billing_audit_log" ADD CONSTRAINT "billing_audit_log_actor_user_id_user_id_fk"
        FOREIGN KEY ("actor_user_id") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_managers_user_id_user_id_fk') THEN
      ALTER TABLE "core"."billing_managers" ADD CONSTRAINT "billing_managers_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_managers_added_by_user_id_fk') THEN
      ALTER TABLE "core"."billing_managers" ADD CONSTRAINT "billing_managers_added_by_user_id_fk"
        FOREIGN KEY ("added_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_cancel_feedback_user_id_user_id_fk') THEN
      ALTER TABLE "core"."billing_cancel_feedback" ADD CONSTRAINT "billing_cancel_feedback_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_trial_uses_user_id_user_id_fk') THEN
      ALTER TABLE "core"."billing_trial_uses" ADD CONSTRAINT "billing_trial_uses_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signup_intents_user_id_user_id_fk') THEN
      ALTER TABLE "core"."signup_intents" ADD CONSTRAINT "signup_intents_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
/*
 * The module CHECK must list all four apps. apps/projects/drizzle/0000_pm_init.sql narrows it to
 * three on a fresh database, so it is set again here. Drop and add is safe to repeat.
 */
ALTER TABLE "core"."entitlements" DROP CONSTRAINT IF EXISTS "entitlements_module_check";
--> statement-breakpoint
ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_module_check"
  CHECK ("module" IN ('crm', 'wms', 'projects', 'pulse'));
--> statement-breakpoint
ALTER TABLE "core"."billing_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_managers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_cancel_feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_test_objects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."billing_trial_uses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core"."signup_intents" ENABLE ROW LEVEL SECURITY;
