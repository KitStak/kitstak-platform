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
| `0000_pulse_init.sql` | The whole `pulse` schema: 46 tables (setup, jobs and plans, the eight dated streams, rollups, control and system tables), `UNIQUE (org_id, id)` and composite `(org_id, x_id)` foreign keys on every table, the shared SD, V and STREAM columns, the append only trigger on `pulse.activity` (SQLSTATE `KP002`), the closed month trigger `pulse.guard_closed_month` on the eight dated streams (SQLSTATE `KP001`, message `month_closed:YYYY-MM`), the rate lookup `pulse.rate_for(org, class, site, date)`, the facts view `pulse.v_facts`, RLS on every table, and the four value entitlement module CHECK. |

Add a row to the table above with each new file.
