-- Move every WMS table out of `public` into the `wms` schema (integration blueprint §2.1:
-- one Supabase Postgres, schemas core / crm / wms). Hand-written (NEVER `drizzle-kit push`;
-- 0003 added hidden rowid identity columns drizzle-kit must not see). Covers the 111 tables
-- from 0000_postgres_baseline plus the 4 runtime tables from 0004_runtime_tables_rls
-- (scheduler_lease, scheduler_task_runs, pack_drafts, eod_auto_close_rules). Indexes,
-- constraints, triggers and RLS state move with their tables.
--
-- Defensive: each table is moved only when it still lives in `public`. On a fresh database
-- where the `wms` schema pre-exists (packages/db core migrations create core/crm/wms first)
-- and a session ran 0000-0005 with a wms-first search_path, tables may already be in `wms`;
-- migrations pin `search_path` to `public` (src/server/db/migrate.ts) so this is belt and
-- braces. NOTE: drizzle/meta snapshots are NOT updated by this hand-written migration; the
-- next `drizzle-kit generate` diff must be hand-checked.
CREATE SCHEMA IF NOT EXISTS wms;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'addresses',
    'algorithm_rules',
    'algorithms',
    'allocation_exceptions',
    'apps',
    'attachments',
    'audit_log',
    'background_tasks',
    'billing_contracts',
    'billing_fee_tiers',
    'billing_fees',
    'billing_report_lines',
    'billing_reports',
    'carrier_call_logs',
    'carrier_connection_clients',
    'carrier_connections',
    'carrier_packages',
    'carrier_services',
    'carrier_third_party_accounts',
    'change_log',
    'channel_connections',
    'channel_location_mappings',
    'channel_methods',
    'channel_missing_orders',
    'channel_run_items',
    'channel_runs',
    'clients',
    'code_sequences',
    'company_settings',
    'count_line_entries',
    'count_plan_lines',
    'count_plans',
    'custom_field_defs',
    'customers',
    'end_of_day_manifests',
    'entity_notes',
    'entity_tags',
    'eod_auto_close_rules',
    'files',
    'import_batches',
    'import_rows',
    'inventory',
    'inventory_allocations',
    'inventory_snapshots',
    'inventory_transactions',
    'job_orders',
    'job_types',
    'jobs',
    'kit_components',
    'kit_inventory_stats',
    'license_plates',
    'location_lp_capacity',
    'location_product_capacity',
    'locations',
    'lookup_values',
    'lp_types',
    'missing_log',
    'mobile_cart_cells',
    'mobile_carts',
    'notifications',
    'order_line_shortages',
    'order_lines',
    'pack_drafts',
    'password_reset_tokens',
    'printout_template_clients',
    'printout_templates',
    'product_barcodes',
    'product_channel_allocations',
    'product_listings',
    'product_pack_types',
    'product_replenishment_levels',
    'products',
    'purchase_order_lines',
    'purchase_order_serials',
    'purchase_orders',
    'rate_limits',
    'rate_shopping_preset_services',
    'rate_shopping_presets',
    'receipts',
    'retailers',
    'return_order_lines',
    'return_orders',
    'role_permissions',
    'roles',
    'saved_views',
    'scheduler_lease',
    'scheduler_task_runs',
    'screen_configs',
    'serial_numbers',
    'serial_transactions',
    'shipment_items',
    'shipment_orders',
    'shipment_package_clients',
    'shipment_packages',
    'shipment_plan_orders',
    'shipment_plans',
    'shipments',
    'tags',
    'tasks',
    'user_clients',
    'user_grid_prefs',
    'user_printers',
    'user_roles',
    'user_sessions',
    'user_warehouses',
    'users',
    'vas_operations',
    'vendors',
    'warehouses',
    'wave_rules',
    'waves',
    'work_order_components',
    'work_orders',
    'workflow_runs',
    'workflows'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA wms', t);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
-- The 0001 trigger function moves too (ALTER FUNCTION keeps the trigger bindings on
-- wms.billing_reports pointing at the same function OID) ...
DO $$
BEGIN
  IF to_regprocedure('public.billing_reports_period_guard()') IS NOT NULL THEN
    ALTER FUNCTION public.billing_reports_period_guard() SET SCHEMA wms;
  END IF;
END
$$;
--> statement-breakpoint
-- ... and its body is re-pointed at wms.billing_reports (it ran with search_path = '' and
-- named public.billing_reports explicitly). Same signature = same OID: triggers keep working.
CREATE OR REPLACE FUNCTION wms.billing_reports_period_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.bill_status <> 'Canceled' AND NEW.calc_status = 'Successful' AND EXISTS (
    SELECT 1 FROM wms.billing_reports b
    WHERE b.contract_id = NEW.contract_id AND b.id <> NEW.id
      AND b.bill_status <> 'Canceled' AND b.calc_status = 'Successful'
      AND substr(b.period_start, 1, 10) <= substr(NEW.period_end, 1, 10)
      AND substr(b.period_end, 1, 10) >= substr(NEW.period_start, 1, 10)
  ) THEN
    RAISE EXCEPTION 'KS_BILL_PERIOD_OVERLAP';
  END IF;
  RETURN NEW;
END
$fn$;
