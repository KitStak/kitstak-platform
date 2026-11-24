/*
 * 0011_core_sign_in_round4: review round 4 for signup and billing (docs/billing/CONTRACTS.md
 * section 27).
 *
 * 1. core.sign_in_blocks: one row per person who is switched off. Until now "switched off" meant
 *    "has no password row in core.account" (auth review 2026-11-11, H3). That stopped being enough
 *    the day a person could get a new password by email: "Forgot password" made a new password row
 *    and the person was back in. It also meant two different things: a person who signs in with an
 *    emailed code has no password row either, and is not switched off.
 *
 *    Now being switched off is a fact of its own. The shared sign in layer (`createAuth` in
 *    @kitstak/auth) reads this table at every door, in every app: no sign in, no session, no new
 *    password, no reset code, no sign in code and no Google or Microsoft sign in for a person with
 *    a row here. The WMS writes the row when it deactivates a person and removes it when it
 *    activates them again.
 *
 * 2. core.user_last_org: the organization a person worked in last. A new session starts there,
 *    instead of in the first organization by name. Written by the shared sign in layer whenever a
 *    person picks an organization.
 *
 * Safe to run again: every statement is IF NOT EXISTS or ON CONFLICT DO NOTHING.
 */
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
--> statement-breakpoint
/*
 * People who are switched off today. The old rule was: inactive in a warehouse AND the password row
 * is gone. Every such person gets a block row, so "Forgot password" cannot bring them back. A person
 * who is inactive in one warehouse but still has a password (their account is shared with another
 * organization, so that warehouse could not switch the account off) is left alone, as before.
 */
DO $$
DECLARE
  tenant text;
BEGIN
  IF to_regclass('core.wms_tenants') IS NULL OR to_regclass('core."user"') IS NULL OR to_regclass('core.account') IS NULL THEN
    RETURN;
  END IF;
  FOR tenant IN
    SELECT "schema_name" FROM "core"."wms_tenants" WHERE "schema_name" ~ '^wms(_[0-9a-f]{32})?$'
    UNION SELECT 'wms'
  LOOP
    IF to_regclass(format('%I.users', tenant)) IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO "core"."sign_in_blocks" ("user_id", "reason")
         SELECT u."id", ''deactivated''
           FROM %I.users w
           JOIN "core"."user" u ON u."id"::text = w."id"::text
          WHERE w."is_active" = false
            AND NOT EXISTS (
              SELECT 1 FROM "core"."account" a
               WHERE a."user_id" = u."id" AND a."provider_id" = ''credential'' AND a."password" IS NOT NULL
            )
         ON CONFLICT ("user_id") DO NOTHING',
        tenant
      );
    END IF;
  END LOOP;
END $$;
