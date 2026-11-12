-- 0001_core_fks — DEFERRED, applied in Phase 3. NOT in meta/_journal.json.
--
-- These foreign keys target core.organization and core."user": the Better Auth tables
-- that only exist after Phase 3 relocates them from the CRM's public schema into core
-- (BLUEPRINT.md §2.1/§2.3). Running this file before that relocation would fail on a
-- fresh database. When Phase 3 lands, append this file as journal entry idx 1 (or run
-- it once by hand); every statement is guarded, so re-running it is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_created_by_user_id_fk') THEN
    ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_created_by_user_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_updated_by_user_id_fk') THEN
    ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_updated_by_user_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."items" ADD CONSTRAINT "items_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_created_by_user_id_fk') THEN
    ALTER TABLE "core"."items" ADD CONSTRAINT "items_created_by_user_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_updated_by_user_id_fk') THEN
    ALTER TABLE "core"."items" ADD CONSTRAINT "items_updated_by_user_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_customers_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."stripe_customers" ADD CONSTRAINT "stripe_customers_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_user_id_user_id_fk') THEN
    ALTER TABLE "wms"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
  END IF;
END $$;
