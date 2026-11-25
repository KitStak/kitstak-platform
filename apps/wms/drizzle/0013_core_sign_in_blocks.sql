-- 0013_core_sign_in_blocks: a person who is switched off, as a fact of its own.
--
-- core.sign_in_blocks holds one row per switched off person. The shared sign in layer
-- (@kitstak/auth createAuth) reads it at every door of every app; the WMS writes it when it
-- deactivates a person and removes it when it activates them again (see
-- src/server/auth/credentials.ts). core.user_last_org holds the organization a person worked in
-- last, so a new session starts there.
--
-- Mirror of packages/db/drizzle/0011_core_sign_in_round4.sql (guarded, idempotent): on the shared
-- platform database the core migration creates the tables and this is a no-op; on a WMS-only
-- database (PGlite tests, local dev) it builds them.
CREATE SCHEMA IF NOT EXISTS "core";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."sign_in_blocks" (
	"user_id"    uuid PRIMARY KEY,
	"reason"     text NOT NULL DEFAULT 'deactivated',
	"blocked_by" uuid,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core."user"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sign_in_blocks_user_id_user_id_fk') THEN
    ALTER TABLE "core"."sign_in_blocks" ADD CONSTRAINT "sign_in_blocks_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."sign_in_blocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."user_last_org" (
	"user_id"    uuid PRIMARY KEY,
	"org_id"     uuid NOT NULL,
	"updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core."user"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_last_org_user_id_user_id_fk') THEN
    ALTER TABLE "core"."user_last_org" ADD CONSTRAINT "user_last_org_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF to_regclass('core.organization') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_last_org_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."user_last_org" ADD CONSTRAINT "user_last_org_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."user_last_org" ENABLE ROW LEVEL SECURITY;
