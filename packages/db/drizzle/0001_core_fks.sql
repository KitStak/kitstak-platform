-- 0001_core_fks — journaled in Phase 3 (BLUEPRINT.md §1.3/§2.1).
--
-- Foreign keys from the 0000_core_init tables to core.organization and core."user":
-- the Better Auth tables that CRM migration 0003_core_auth relocates from `public`
-- into `core`. packages/db migrations may run standalone, BEFORE the CRM migrations
-- have created/relocated those tables, so every FK is guarded on the TARGET table
-- (`to_regclass`) and skipped gracefully when it does not exist. Each ALTER is also
-- guarded on the constraint name, so re-running the whole file is a no-op.
--
-- NOTE: the runner records this tag as applied even when the targets were absent and
-- the FKs were skipped. If this migration ran against a database before the CRM
-- migrations created the core auth tables, re-execute this file once by hand after
-- they exist (psql -f, or any client) — it is idempotent.
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."items" ADD CONSTRAINT "items_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_customers_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."stripe_customers" ADD CONSTRAINT "stripe_customers_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_org_id_organization_id_fk') THEN
      ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_org_id_organization_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE CASCADE;
    END IF;
  END IF;

  IF to_regclass('core."user"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_created_by_user_id_fk') THEN
      ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_created_by_user_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_updated_by_user_id_fk') THEN
      ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_updated_by_user_id_fk"
        FOREIGN KEY ("updated_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_created_by_user_id_fk') THEN
      ALTER TABLE "core"."items" ADD CONSTRAINT "items_created_by_user_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_updated_by_user_id_fk') THEN
      ALTER TABLE "core"."items" ADD CONSTRAINT "items_updated_by_user_id_fk"
        FOREIGN KEY ("updated_by") REFERENCES "core"."user"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_user_id_user_id_fk') THEN
      ALTER TABLE "wms"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
