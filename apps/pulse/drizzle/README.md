# KitStak Pulse migrations (`pulse` schema)

Hand-written SQL, applied by `pnpm --filter kitstak-pulse db:migrate` (`scripts/db-migrate.ts`).

- Only files listed in `meta/_journal.json` are applied, strictly in `idx` order.
- Applied tags are recorded with a content hash in `drizzle.__kitstak_pulse_migrations`;
  editing an applied file aborts the run. Add a new migration instead.
- Each migration runs in its own transaction under a `pg_advisory_lock` (key `7_202_611_505`; skipped
  with a warning on a transaction-mode pooler URL, port 6543 / `pgbouncer=true`; use the direct URL, `DIRECT_URL`).
- Statements are separated by `--> statement-breakpoint` lines.
- Every `pulse` table has RLS enabled and one policy, `pulse_org_isolation`, for all commands: a row is allowed only
  when its `org_id` equals the session setting `pulse.org_id` (`0007_rls_policies.sql`). The server role owns the
  tables and RLS is not forced. With `PULSE_DB_GUARD=1` the app runs its queries as the plain role `pulse_app`
  (`0009_db_guard_role.sql`) with that setting, so the policies apply to the app itself. A new table needs its own
  policy in the migration that makes it: `src/server/domain/rls.db.test.ts` fails when a table has RLS on and no policy.
  A new table gets its grants for `pulse_app` by itself (default privileges set in `0009`).
- **Never run `drizzle-kit push`.** The Drizzle schema in `src/server/db/schema/` mirrors these files
  for typed queries only.
- Requires the shared platform tables first (`core.organization`, `core."user"`, `core.customers`,
  `core.entitlements`). On a fresh database the order is `@kitstak/db`, CRM, WMS, Projects, then Pulse
  **last**: `apps/projects/drizzle/0000_pm_init.sql` narrows the entitlement module CHECK to three
  values, and `0000_pulse_init.sql` widens it back to `('crm', 'wms', 'projects', 'pulse')`.

| File | Contents |
| --- | --- |
| `0000_pulse_init.sql` | The whole `pulse` schema: 46 tables (setup, jobs and plans, the eight dated streams, rollups, control and system tables), `UNIQUE (org_id, id)` and composite `(org_id, x_id)` foreign keys on every table, the shared SD, V and STREAM columns, the append only trigger on `pulse.activity` (SQLSTATE `KP002`), the closed month trigger `pulse.guard_closed_month` on the eight dated streams (SQLSTATE `KP001`, message `month_closed:YYYY-MM`), the rate lookup `pulse.rate_for(org, class, site, date)`, the facts view `pulse.v_facts`, RLS on every table, and the four value entitlement module CHECK. |
| `0005_saved_view_pages.sql` | Widens the `saved_views.page` CHECK with `audit` and `export`, so the audit log and the export page can keep saved views (data team). |
| `0007_rls_policies.sql` | Row level security policies. One policy on each of the 46 tables, for read, add, change and remove: `org_id` must equal the session setting `pulse.org_id` (`set_config('pulse.org_id', '<org uuid>', true)`). No setting means no rows and no writes. A table with no `org_id` would get a policy that allows nothing (there is none today). The facts view `pulse.v_facts` is set to `security_invoker`, so the policies also apply through the view. RLS is not forced on the owner and nothing is granted to any role. Safe to run again (each policy is dropped, then made). |
| `0009_db_guard_role.sql` | The plain role for the database guard. Makes `pulse_app` if it is missing (no login, not a superuser, cannot skip RLS, owns nothing), lets the migration role become it, grants it read and write on the `pulse` tables, use of the sequences and run of the functions (also for tables made later), and read on `core.organization`, `core.member` and `core."user"` behind a policy for `pulse_app` only (rows of the workspace in `pulse.org_id`). Nothing changes for the running app until `PULSE_DB_GUARD=1` is set. Every step is safe to run again, and a step the migration role may not do is skipped with a NOTICE. |
| `0011_wms_contract_prices_switch.sql` | Adds `settings.wms_contract_prices` (boolean, default true): the off switch for the rule that lets the warehouse contract set the price of a linked job. On by default, so nothing changes until someone turns it off on Connected apps. |

Add a row to the table above with each new file.
