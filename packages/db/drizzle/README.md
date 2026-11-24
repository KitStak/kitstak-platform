# @kitstak/db migrations

Hand-maintained SQL migrations for the shared `core` / `crm` / `wms` platform tables
(BLUEPRINT.md §2.3). The target is a fresh, empty Supabase project — migrations build
everything from zero, in journal order.

## How it runs

- `meta/_journal.json` (drizzle-kit journal format, version 7) lists the applied set, in
  order. **Only files listed in the journal are applied.**
- `pnpm --filter @kitstak/db db:migrate [connection-string]` runs
  `scripts/db-migrate.ts`: idempotent (applied tags are recorded in
  `drizzle.__kitstak_db_migrations` and skipped), strictly in journal order, each
  migration in its own transaction, under a `pg_advisory_lock` session lock (skipped
  with a warning on a transaction-mode pooler URL — port 6543 / `pgbouncer=true` —
  where a session lock can leak; prefer the direct/session connection, `DIRECT_URL`).
- Statements are separated by `--> statement-breakpoint` lines, drizzle style.
- **Never run `drizzle-kit push` anywhere in this repo** (WMS migration
  `0003_rowid_columns.sql` has hidden rowid identity columns; push corrupts them).

## Files

| File | Journal | Contents |
| --- | --- | --- |
| `0000_core_init.sql` | idx 0 | `CREATE SCHEMA core/crm/wms`; `core.customers`, `core.items`, `core.stripe_customers`, `core.entitlements`, `core.billing_events`, `crm.customer_links`, `crm.core_item_links`, `wms.user_profiles`; indexes; RLS enabled (no policies) on every table. |
| `0001_core_fks.sql` | idx 1 | FKs from the tables above to `core.organization` / `core."user"` — the Better Auth tables that CRM migration `apps/crm/drizzle/0003_core_auth.sql` relocates from `public` into `core` (Phase 3). Every FK is guarded on the TARGET table's existence (`to_regclass`), so a standalone run against a database that does not yet have the auth tables skips them gracefully; each ALTER is also guarded on the constraint name, so re-runs are no-ops. **Caveat:** the runner records the tag as applied even when the targets were absent — if that happened, re-execute the file once by hand after the CRM migrations have created the core auth tables (it is idempotent). |
| `0002_core_onboarding.sql` | idx 2 | `core.onboarding_progress` (guided setup state shared by portal, CRM and WMS). |
| `0003_core_password_change_required.sql` | idx 3 | `core.password_change_required`: users who must replace an administrator-set password. In force only while the stored hash still matches `core.account.password`. FK to `core."user"` guarded like `0001`. |
| `0004_core_projects_module.sql` | idx 4 | Widens `core.entitlements_module_check` to `('crm', 'wms', 'projects')` for KitStak Projects. |
| `0005_core_wms_tenants.sql` | idx 5 | `core.wms_tenants`: organization → the Postgres schema holding its WMS warehouse (`wms` for the platform org, `wms_<org hex>` for every other org). Registers the platform org's existing `wms` schema. Mirrored by `apps/wms/drizzle/0012_core_wms_tenants.sql`. |
| `0006_core_pulse_module.sql` | idx 6 | Widens `core.entitlements_module_check` to `('crm', 'wms', 'projects', 'pulse')` for KitStak Pulse. `apps/pulse/drizzle/0000_pulse_init.sql` re-asserts the same four values, because `apps/projects/drizzle/0000_pm_init.sql` narrows the CHECK to three on a fresh database (Pulse migrates last). |
| `0007_core_billing.sql` | idx 7 | Signup and billing (`docs/billing/CONTRACTS.md` section 9). New tables `core.billing_accounts`, `billing_subscriptions`, `billing_invoices`, `billing_audit_log`, `billing_managers`, `billing_cancel_feedback`, `billing_emails`, `billing_test_objects`, `billing_trial_uses` and `core.signup_intents`, all with RLS enabled and no policies. Widens `core.billing_events` (the webhook ledger) with `org_id`, `gateway`, `status`, `error`, `attempts`, `received_at`. Sets `entitlements_module_check` to the four modules again. Foreign keys are guarded like `0002`, with the same caveat as `0001`: if this file ran before the CRM migrations created the core auth tables, run it once more by hand afterwards (it is safe to repeat). Mirrored in `src/schema/core/billing.ts` and `src/schema/core/billing-tables.ts`. |
| `0008_core_billing_credit.sql` | idx 8 | Review round 1 for signup and billing. `core.billing_subscriptions` gets `credit_cents`, `next_charge_cents`, `next_discount_cents`, `next_discount_label`, `next_credit_cents` (the credit balance and what the next bill really charges). `core.billing_invoices` gets `credit_applied_cents` and `refunded_cents`. A trigger on `core.member` (`core.billing_manager_cleanup`) deletes the `core.billing_managers` row of a person who is removed, leaves or is deactivated, and writes one `core.billing_audit_log` line. Guarded on `core.member` like `0007`: if this file ran before the CRM migrations made the auth tables, run it once more by hand. |
| `0009_core_billing_locks.sql` | idx 9 | Review round 2 for signup and billing. `core.billing_locks`: one lease row per organization while a billing step that talks to the gateway runs (opening checkout, confirming a plan change), so two of them never run at the same moment for one organization. The lease ends by itself and holds no database connection. RLS enabled, no policies. The foreign key is guarded on `core.organization` like `0007`. |
| `0010_core_billing_round3.sql` | idx 10 | Review round 3 for signup and billing. `core.billing_subscriptions` gets `ended_reason`, `ended_amount_cents` and `ended_attempts` (why a plan ended, for the email, billing home and the activity line). New table `core.billing_stamps`: one number per organization that triggers bump on every write to `core.entitlements`, `core.billing_subscriptions`, `core.billing_accounts` and `core.billing_managers`, so every app sees a billing change on its next request. A deferred trigger on `core.organization` removes the stamp of a deleted organization. RLS enabled, no policies. Guarded on the watched tables like `0008`. |

## Conventions (§2.2)

uuid PKs `DEFAULT gen_random_uuid()`, `timestamptz` timestamps, `created_by`/`updated_by`
uuid + `version integer DEFAULT 1`, soft delete `deleted_at`, enums as `text` + CHECK.
