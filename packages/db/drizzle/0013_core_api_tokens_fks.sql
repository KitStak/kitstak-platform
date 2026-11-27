/*
 * 0013_core_api_tokens_fks: the foreign keys 0012 meant to add to core.api_tokens.
 *
 * 0012 guarded each foreign key on its constraint NAME alone. CRM's own `crm.api_tokens` already has
 * constraints called `api_tokens_org_id_organization_id_fk` and `api_tokens_user_id_user_id_fk`, so
 * on every database that has CRM the guard found those and skipped core.api_tokens. The tokens still
 * worked and still died with their owner (membership check, 0012 triggers), but deleting a person or
 * an organization left their token rows behind. 0012 is not edited: databases record its hash.
 *
 * Here the names are unique to the core table and each guard checks the table too. Rows whose person
 * or organization is already gone are deleted first (they can never authenticate), so the keys can
 * be added. core.api_token_events already got its organization key in 0012 (that name was free).
 *
 * Safe to run again.
 */
DELETE FROM "core"."api_tokens" t
 WHERE (to_regclass('core.organization') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "core"."organization" o WHERE o."id" = t."org_id"))
    OR (to_regclass('core."user"') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "core"."user" u WHERE u."id" = t."user_id"));
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'core_api_tokens_org_id_fk' AND conrelid = 'core.api_tokens'::regclass
  ) THEN
    ALTER TABLE "core"."api_tokens" ADD CONSTRAINT "core_api_tokens_org_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
  END IF;
  IF to_regclass('core."user"') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'core_api_tokens_user_id_fk' AND conrelid = 'core.api_tokens'::regclass
  ) THEN
    ALTER TABLE "core"."api_tokens" ADD CONSTRAINT "core_api_tokens_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
  END IF;
END $$;
