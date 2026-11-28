-- KitStak Ledger 0001: customers, vendors and the setup lists (docs/ledger/SPEC.md 13, Phase 1).
-- Safe to run again: every statement is IF NOT EXISTS.
--
-- 1. ledger.vendor_profiles.ledger_kinds: the kinds of a core.vendors row that Ledger added (from
--    its own screens or an import). core.vendors.kinds is shared with Crew (temp_agency) and later
--    the WMS, so Ledger never drops a kind that is not in this list unless the person says so.
-- 2. A tax rate name is unique among live rates, like items (code), accounts (number), terms
--    (name) and vendors (core, name).
ALTER TABLE "ledger"."vendor_profiles" ADD COLUMN IF NOT EXISTS "ledger_kinds" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_name_key" ON "ledger"."tax_rates" ("org_id", lower("name")) WHERE "archived_at" IS NULL;
--> statement-breakpoint
-- Live item names are looked up without case by the import check; this keeps that read cheap.
CREATE INDEX IF NOT EXISTS "items_name_idx" ON "ledger"."items" ("org_id", lower("name")) WHERE "archived_at" IS NULL;
