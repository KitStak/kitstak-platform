# KitStak Pulse migrations (`pulse` schema)

Hand-written SQL, applied by `pnpm --filter kitstak-pulse db:migrate` (`scripts/db-migrate.ts`).

- Only files listed in `meta/_journal.json` are applied, strictly in `idx` order.
- Applied tags are recorded with a content hash in `drizzle.__kitstak_pulse_migrations`;
  editing an applied file aborts the run. Add a new migration instead.
- Each migration runs in its own transaction under a `pg_advisory_lock` (key `7_202_611_505`; skipped
  with a warning on a transaction-mode pooler URL, port 6543 / `pgbouncer=true`; use the direct URL, `DIRECT_URL`).
- Statements are separated by `--> statement-breakpoint` lines.
- Every `pulse` table has RLS enabled (no policies; the server role owns the tables).
- **Never run `drizzle-kit push`.** The Drizzle schema in `src/server/db/schema/` mirrors these files
  for typed queries only.
- Requires the shared platform tables first (`core.organization`, `core."user"`, `core.customers`,
  `core.entitlements`). On a fresh database the order is `@kitstak/db`, CRM, WMS, Projects, then Pulse
  **last**: `apps/projects/drizzle/0000_pm_init.sql` narrows the entitlement module CHECK to three
  values, and `0000_pulse_init.sql` widens it back to `('crm', 'wms', 'projects', 'pulse')`.

| File | Contents |
| --- | --- |

The journal starts empty. The first migration is `0000_pulse_init.sql` (journal entry `idx 0`,
tag `0000_pulse_init`); add a row to the table above with each new file.
