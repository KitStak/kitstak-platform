-- Notification emails: the scheduler (every 5 minutes) emails each active member the notifications
-- they have not read yet, grouped into one email and following their email setting.
--   email_handled_at  the scheduler is done with this row (sent, read first, or not for email)
--   emailed_at        the email that carried this row went out (used to pace daily and weekly email)
--
-- Rows that exist before this migration are marked handled now, so nobody gets an email about old
-- notifications on the first run.
ALTER TABLE "crm"."notifications" ADD COLUMN IF NOT EXISTS "email_handled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "crm"."notifications" ADD COLUMN IF NOT EXISTS "emailed_at" timestamptz;--> statement-breakpoint
UPDATE "crm"."notifications" SET "email_handled_at" = now() WHERE "email_handled_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_email_pending_idx" ON "crm"."notifications" ("user_id", "created_at") WHERE "email_handled_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_emailed_idx" ON "crm"."notifications" ("user_id", "emailed_at") WHERE "emailed_at" IS NOT NULL;
