/*
 * 0012_core_vendors: one shared vendor list (docs/crew/SPEC.md, docs/ledger/SPEC.md).
 *
 * The same companies show up in three apps: a temp agency sends people to Crew and bills to
 * Ledger, a box supplier ships to the WMS and bills to Ledger, a carrier picks up from the WMS and
 * bills to Ledger. So vendors are a core record, like core.customers, and every app names the same
 * row. `kinds` says what a vendor is to the shop (one company can be several). `external_refs`
 * holds ids in other systems, for example {"qbo_vendor_id": "58"} once Ledger syncs to QuickBooks
 * Online.
 *
 * Archived vendors stay for history (old bills, old agency people) and leave pickers and the
 * name uniqueness rule. Safe to run again: every statement is IF NOT EXISTS or guarded.
 */
CREATE TABLE IF NOT EXISTS "core"."vendors" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL,
  "name"          text NOT NULL,
  "kinds"         text[] NOT NULL DEFAULT '{}',
  "email"         text,
  "phone"         text,
  "address"       jsonb,
  "notes"         text,
  "external_refs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "archived_at"   timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "created_by"    uuid,
  "updated_by"    uuid,
  "version"       integer NOT NULL DEFAULT 1,
  "deleted_at"    timestamptz,
  CONSTRAINT "vendors_kinds_check" CHECK (
    "kinds" <@ ARRAY['supplier', 'carrier', 'temp_agency', 'landlord', 'utility', 'service', 'other']::text[]
  ),
  CONSTRAINT "vendors_name_not_blank" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_org_name_unique"
  ON "core"."vendors" ("org_id", lower("name"))
  WHERE "archived_at" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_org_idx" ON "core"."vendors" ("org_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_kinds_idx" ON "core"."vendors" USING gin ("kinds");
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('core.organization') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_org_id_organization_id_fk') THEN
    ALTER TABLE "core"."vendors" ADD CONSTRAINT "vendors_org_id_organization_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."vendors" ENABLE ROW LEVEL SECURITY;
