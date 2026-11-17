-- KitStak Pulse becomes the fourth licensable module: widen the core.entitlements
-- module CHECK (kept in lockstep with ENTITLEMENT_MODULES in src/schema/core/billing.ts and
-- MODULES in @kitstak/entitlements). Drop + re-add is idempotent and safe to re-run.
ALTER TABLE "core"."entitlements" DROP CONSTRAINT IF EXISTS "entitlements_module_check";
--> statement-breakpoint
ALTER TABLE "core"."entitlements" ADD CONSTRAINT "entitlements_module_check"
  CHECK ("module" IN ('crm', 'wms', 'projects', 'pulse'));
