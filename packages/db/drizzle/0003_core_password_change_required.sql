-- core.password_change_required: users who must replace an administrator-set password
-- before using the portal or CRM.
--
-- A row holds the credential hash that was current when the requirement was set. The
-- requirement is in force only while core.account.password still equals that hash, so
-- ANY successful password change (portal screen, CRM profile, reset) lifts it without a
-- separate write, and a stale row is inert.
-- The FK below briefly locks core."user"; give up rather than queue behind a long transaction.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."password_change_required" (
  "user_id"         uuid PRIMARY KEY,
  "credential_hash" text NOT NULL,
  "reason"          text NOT NULL DEFAULT 'provisioned',
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "password_change_required_reason_check"
    CHECK ("reason" IN ('provisioned', 'admin_reset'))
);
--> statement-breakpoint
ALTER TABLE "core"."password_change_required" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- FK guarded on the target table, 0001_core_fks pattern: packages/db migrations may run
-- standalone before the CRM migrations relocate the Better Auth tables into `core`.
DO $$
BEGIN
  IF to_regclass('core."user"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_change_required_user_id_user_id_fk') THEN
      ALTER TABLE "core"."password_change_required" ADD CONSTRAINT "password_change_required_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
