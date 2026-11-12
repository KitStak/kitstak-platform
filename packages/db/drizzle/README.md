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
| `0000_core_init.sql` | idx 0 | `CREATE SCHEMA core/crm/wms`; `core.customers`, `core.items`, `core.stripe_customers`, `core.entitlements`, `core.billing_events`, `crm.customer_links`, `crm.item_links`, `wms.user_profiles`; indexes; RLS enabled (no policies) on every table. |
| `0001_core_fks.sql` | **NOT in journal — deferred, applied in Phase 3** | FKs from the tables above to `core.organization` / `core."user"`. Those are the Better Auth tables that Phase 3 relocates from the CRM `public` schema into `core`; the FKs cannot exist before that relocation. When Phase 3 lands, append the file as journal entry idx 1 (it becomes part of the normal run) or execute it once by hand — every statement is guarded, so re-runs are no-ops. |

## Conventions (§2.2)

uuid PKs `DEFAULT gen_random_uuid()`, `timestamptz` timestamps, `created_by`/`updated_by`
uuid + `version integer DEFAULT 1`, soft delete `deleted_at`, enums as `text` + CHECK.
