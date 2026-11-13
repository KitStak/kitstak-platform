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

## Conventions (§2.2)

uuid PKs `DEFAULT gen_random_uuid()`, `timestamptz` timestamps, `created_by`/`updated_by`
uuid + `version integer DEFAULT 1`, soft delete `deleted_at`, enums as `text` + CHECK.
