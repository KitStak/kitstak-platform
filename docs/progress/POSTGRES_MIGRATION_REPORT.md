# Postgres migration report (SQLite → Postgres / Supabase + Vercel)

Branch `feat/postgres-supabase`, 2026-11-10. Nothing is committed. Reference guide: `docs/POSTGRES_MIGRATION.md`.

## 1. What changed

- **Drivers** (`src/server/db/index.ts`). With `DATABASE_URL` set, the app uses postgres-js + `drizzle-orm/postgres-js` against the Supabase transaction pooler (`prepare: false`, pool of 3 on Vercel and 5 elsewhere, int8 parsed as a number the way PGlite does it). Without it, the app uses PGlite persisted at `.data/pglite` (migrations applied automatically on first open, one process per data directory enforced by a lock file). Tests use in-memory PGlite. `AppDb` is a Postgres database/transaction type that both drivers satisfy.
- **Schema.** `sqlite-core` was replaced with `pg-core`. Table and column names are unchanged. Ids and ISO timestamps stay `text`, `integer` stays `integer`, `real` became `doublePrecision`, `bool()` became `boolean` and `json()` became `jsonb`. Indexes and unique constraints are preserved.
- **Migrations** (`drizzle/`). The SQLite migrations were replaced by:
  - `0000_postgres_baseline` (drizzle-kit, Postgres dialect)
  - `0001_billing_period_guard` (port of the SQLite billing trigger)
  - `0002_enable_rls` (RLS on every schema table, no policies)
  - `0003_rowid_columns` (identity `rowid` on the 3 tables that ordered by it)
  - `0004_runtime_tables_rls` (new in this pass, see §4)
- **Raw SQL** goes through `dbAll` / `dbGet` / `dbRun` in `src/server/db/sql.ts`, which normalize the result shapes of the two drivers. The file also holds the savepoint helpers (`bestEffort`, `inSavepoint`), SQLSTATE error helpers, sequential async array helpers and the SQLite→Postgres expression helpers.
- **Async conversion.** All query-builder `.get()` / `.all()` / `.run()` calls became awaited queries. Repository, domain and route functions are async and their callers await them.
- **Write serialization.** Mutating `defineRoute` handlers run in `db.transaction` and call `takeWriteLock(tx)` first (`pg_advisory_xact_lock` on one fixed app-wide key). Every other write path (scheduler, cron tick, imports, seeds, scripts) uses `withWriteTx`. The "Transactional handler must be synchronous" guard was removed.
- **Tests.** `createTestDb()` is async. Each worker migrates once and keeps a dump of the result. Databases are restored from that dump, truncated and pooled between tests.
- **Platform.**
  - The scheduler never starts in-process on Vercel. Vercel Cron calls `GET /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
  - File bytes go through a `BlobStorage` adapter: local disk by default, or the Supabase Storage bucket `wms-files` when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
  - `.env.example` documents every variable the app reads.

### Changes in this final pass

| Area | Files |
|---|---|
| SQLite NULL sort placement | new `src/server/db/order.ts` (`asc`/`desc` that add `NULLS FIRST`/`NULLS LAST` on nullable columns and SQL expressions, and leave NOT NULL columns plain so they still use their indexes). 90 files that imported `asc`/`desc` from `drizzle-orm` now import them from here. Raw SQL: `returns-grid.ts` (user sort), `packing-scan.ts` (`expected_ship_date ASC NULLS FIRST`) |
| Boolean grid filter | `src/server/query/filters.ts` (`bool` compares the text form: `IN ('true','1')` / `IN ('false','0')`) |
| Boolean raw selects | `counts-sheet.ts`, `counts-export.ts` (`isRecountLine`); `inventory-by-location.ts` (`track_*::int`, so the API returns 0/1 as before) |
| Backslash in LIKE | `repositories/shared.ts` `likePattern` doubles `\`. Raw user-input `ILIKE` sites get `ESCAPE ''`, which is SQLite behaviour: `algorithms.ts`, `kits.ts`, `packing-scan.ts`, `packing-hospitals.ts`, `returns-receive.ts`, `shipping-label-candidates.ts`, `workflows.ts` |
| Read-then-write races | `auth/login.ts` (failure count re-read under the write lock; a request that lost the race to a lockout does not clear it); `auth/password-reset.ts` (claims the token with `WHERE used_at IS NULL ... RETURNING` and rolls back if the claim fails); `repositories/printouts.ts` (defaults re-checked and inserted under `withWriteTx`); `repositories/company.ts` (`onConflictDoNothing` + re-select) |
| RLS on runtime tables | `drizzle/0004_runtime_tables_rls.sql` + journal entry + snapshot `0004_snapshot.json` |
| Migrations through a pooler | `src/server/db/migrate.ts` (`isTransactionPoolerUrl`: on port 6543 / `pgbouncer=true` the session lock is skipped, with a warning) |
| Cron cadence | `src/server/scheduler/runner.ts` (`dueSlackMs`: a task is due up to min(10 s, interval/4) early) |
| Vercel misconfiguration | `db/index.ts` (`openDatabase` throws a clear "DATABASE_URL is not set" error on Vercel); `files/files.ts` (on Vercel without Supabase Storage, `put` fails with a clear configuration error) |
| Bundle tracing | `next.config.ts` (`outputFileTracingExcludes` for `.data/**`); `turbopackIgnore` hints on the fs calls in `files.ts` and `db/index.ts`; new `.vercelignore` (`.data`, `.env*`, build/test output) |
| Docs | `docs/POSTGRES_MIGRATION.md` §1 and §5 (order helper, LIKE escape, runtime tables) |
| Tests | new `tests/unit/foundation-f3/pg-review-fixes.test.ts` (7 tests). Extended `tests/unit/foundation/pg-schema.test.ts` (runtime-table RLS, Vercel guards, pooler URL detection) and `tests/unit/foundation-f6/scheduler.test.ts` (cron jitter) |

## 2. Gate results (local PGlite)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 193 warnings (unused variables and similar) |
| `npm test` | **279 files, 2,464 tests, all pass** (86.7 s) |
| `npm run db:reset` | pass: 5 of 5 migrations applied, seed complete in 50.4 s (2,801 replay events; e.g. 911 inventory rows, 3,106 inventory_transactions, 424 shipment_orders, 25 printout_templates), fixtures applied |
| `npm run db:verify` | **OK: every invariant reconciles.** buckets=919, transactions=3133, activeAllocations=25, orderLines=702, receipts=95, onHandUnits=48657; 266 non-failing `empty-bucket` warnings |

Not run here: `next build`, Playwright e2e, and anything against a real Supabase database.

## 3. Semantic changes made (SQLite → Postgres)

- **NULL order.** SQLite puts NULLs first ascending and last descending. Postgres does the opposite, so this is now explicit everywhere it shows: `compileSort`, the `@/server/db/order` helpers (FEFO in work orders, kits and seeds, plus the orders, purchase-order, work-order, returns and platform order-picker grids), and nullable raw `ORDER BY`s.
- **LIKE.** SQLite LIKE is case-insensitive, so grid search and filters use `ILIKE`. SQLite has no LIKE escape character; Postgres uses `\`. User input therefore either doubles its backslashes or uses `ESCAPE ''`.
- **Booleans.** Booleans are `true`/`false`, not 1/0. `= 1` on boolean columns was fixed. Where a response used to carry 0/1, the SQL casts with `::int`. Where code compared with `=== 1`, it now also accepts `true`. The grid `bool` filter covers boolean columns, 0/1 expressions and jsonb toggles.
- **Numbers.** `COUNT`/`SUM` are int8 and come back as JS numbers on both drivers. `numeric` results are cast with `::float8`.
- **Dates and JSON.** `strftime`/`datetime`/`julianday` became `to_char`/timestamptz arithmetic that produces the same ISO text, with every session in UTC. The json functions became jsonb operators. `group_concat` became `string_agg`. The SQLite "bare column next to MAX()" trick became `array_agg(... ORDER BY ...)[1]`.
- **Upserts and lookups.** `INSERT OR IGNORE/REPLACE` became `onConflictDoNothing`/`onConflictDoUpdate`. `last_insert_rowid` became `RETURNING`. `PRAGMA` was removed. `pragma_table_info` became `information_schema`.
- **Errors in transactions.** A failed statement aborts the whole Postgres transaction. Best-effort writes inside a transaction run in savepoints (`bestEffort` / `inSavepoint`).
- **Concurrency.** The SQLite driver was synchronous, so a read-then-write inside one function could not interleave with another request. On Postgres, every write path either takes the app write lock or uses a conditional/conflict-safe statement. That covers mutating routes and background writers, plus the four GET/auth paths fixed in this pass.

## 4. Review findings: confirmed vs rejected

All 15 findings were re-checked against the code and confirmed. None was rejected.

| # | Finding | Verdict | Fix |
|---|---|---|---|
| 1 | Grid `bool` filter on jsonb toggles throws `invalid input syntax for type integer` | Confirmed (`(expr)::int` on `'true'`) | Text comparison, covered by a test |
| 2 | FEFO puts undated stock last (work orders, kits, seeds) | Confirmed | `@/server/db/order` `asc` adds `NULLS FIRST`, covered by a test |
| 3 | `isRecountLine === 1` is always false (count sheet, detail export) | Confirmed | Accepts `true` |
| 4 | Grid user sorts lost SQLite NULL placement (orders, PO, WO, returns, order picker) | Confirmed | Order helpers; raw `NULLS` in returns-grid |
| 5 | By-location `trackExpiry !== 0` with `false`; API changed 0/1 to true/false | Confirmed | `::int` in the select, which restores 0/1 |
| 6 | Backslash in inventory search matches nothing | Confirmed (it also affected other raw ILIKE sites) | `likePattern` doubles `\`; `ESCAPE ''` on the raw sites; covered by a test |
| 7 | Concurrent failed logins lose increments, so lockout never triggers | Confirmed | Re-read and update under `withWriteTx`, covered by a test |
| 8 | A reset token can be redeemed twice | Confirmed | Conditional claim + rollback, covered by a test |
| 9 | Concurrent first GETs duplicate the locked default printouts | Confirmed | Re-check and insert under the write lock, covered by a test |
| 10 | Concurrent first `getCompany` fails with a PK violation | Confirmed | `onConflictDoNothing` + re-select, covered by a test |
| 11 | Runtime-created tables have no RLS on Supabase | Confirmed | Migration `0004` creates all 4 with RLS, covered by a test |
| 12 | `db:migrate` session lock can leak through the transaction pooler | Confirmed | Lock skipped (with a warning) on pooler URLs; `.env.example` says to use `DIRECT_URL` |
| 13 | Vercel Cron jitter halves the cadence of 60 s tasks | Confirmed | Due slack of min(10 s, interval/4); local cadence unchanged; covered by a test. The 30 s `wave-rules` task still runs only once a minute on Vercel (cron granularity) |
| 14 | No guard against local-disk fallback on Vercel (opaque EROFS) | Confirmed | Clear errors for a missing DB URL or missing file storage on Vercel, covered by a test |
| 15 | File tracer may bundle `.data` (DB, files, auth states) | Confirmed in principle. The evidence was a stale SQLite-era `.next` build; the same code pattern is still present | `outputFileTracingExcludes`, `turbopackIgnore` hints, `.vercelignore`. **Not verified with a fresh `next build`** |

## 5. Deployment: Supabase + Vercel

Env var names only. Never commit values.

1. **Supabase project "KitStak WMS".** Under Connect, copy:
   - the **transaction pooler** URL (port 6543): this is `DATABASE_URL`;
   - the **direct** connection (`db.<ref>.supabase.co:5432`), or the **session pooler** (port 5432) from IPv4-only networks: this is `DIRECT_URL`;
   - the project URL: this is `SUPABASE_URL`;
   - the service-role key: this is `SUPABASE_SERVICE_ROLE_KEY` (server-only).
2. **Migrate from a workstation.** The scripts do not read `.env.local`, so export the variables in the shell first:
   - `DIRECT_URL=<direct or session URL> npm run db:migrate`
   - This applies `0000` through `0004`, including RLS. It must report `applied 5 migration(s); 5 total`, and later runs must report 0. Optional check: Supabase → Advisors → Security should show no "RLS disabled" tables.
3. **Seed (optional, demo data only).**
   - `DATABASE_URL=<pooler URL> SEED_PASSWORD=<pw> npm run db:seed`
   - Then `npm run db:fixtures` (also optional) and `DATABASE_URL=... npm run db:verify` (it must print `OK`).
   - The seed refuses to run when `NODE_ENV=production` unless `ALLOW_PROD_SEED=1` is set. Do not seed a real production tenant.
   - `npm run db:reset` (drop + migrate + seed + fixtures) drops every table. Never point it at production.
4. **Vercel project environment variables** (Production, and Preview if Preview deploys are used; without `DATABASE_URL` every request fails with a clear "DATABASE_URL is not set" error):
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` (≥32 bytes), `CRON_SECRET`
   - optional: `DATABASE_POOL_MAX`, `DEMO_MODE` (leave unset)
   - `DIRECT_URL` is not needed at runtime
   - `SCHEDULER_ENABLED` has no effect on Vercel
5. **Cron.** `vercel.json` already declares `{"path": "/api/cron/tick", "schedule": "* * * * *"}`. Every-minute crons need the Pro plan; on Hobby, change it to a daily schedule (most scheduled jobs then run once a day). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. Without `CRON_SECRET` the endpoint returns 503.
6. **Storage.** The bucket `wms-files` (private) is created on the first upload. It can also be created up front in Supabase Storage.
7. **Deploy.** Use git integration or `vercel --prod`. `.vercelignore` keeps `.data` and env files out of CLI uploads. After deploying:
   - `GET /api/health` must return 200 with `status: "ok"` and `migrations.applied: 5`;
   - sign in;
   - upload a file (it must land in the `wms-files` bucket);
   - confirm that cron invocations return 200 in the Vercel logs.

## 6. Known risks

- **Throughput.** The global advisory write lock serializes every write, the same way SQLite did. This is correct, but write throughput is that of one writer, and a slow mutating request blocks the others. Keep `DATABASE_POOL_MAX` small. Long imports and seeds hold the lock for their whole duration.
- **Remaining unlocked read-then-write paths.** GET handlers run without the write lock. The four known read-then-write paths are fixed, but any other GET that writes ("ensure on read" or a self-heal) could still race. The ones reviewed (`ensureDefaultInventoryReasons`, `ensureNextRuns`) are conflict-safe or guarded.
- **NULL ordering coverage.** The order helpers cover query-builder sorts. Raw `ORDER BY` strings were reviewed: the explicit ASC/DESC ones are on NOT NULL columns or now spell out NULLS. A raw `ORDER BY nullable_col` with no direction keyword may still exist in less-visited code.
- **Text collation.** SQLite compared bytes. PGlite uses `C`, but Supabase's default is `en_US.UTF-8`, so grid text sorts can differ in case and punctuation order between local and production. This is not changed globally.
- **int4 limits.** SQLite integers were 64-bit. Postgres `integer` columns are int4 (max 2,147,483,647), so a counter or money-in-cents value above that now fails with an out-of-range error. int8 values beyond 2^53 come back as BigInt.
- **Cron granularity.** Vercel Cron runs at most once a minute (Pro plan). The 30 s wave-rules task runs every minute on Vercel, and on Hobby everything runs daily. Each tick runs the due tasks one after another inside one function invocation. The cron route sets no `maxDuration`, so the plan's default function timeout applies and a long tick can be cut off.
- **Migrations without `DIRECT_URL`.** `db:migrate` through the transaction pooler runs without its concurrency lock. Do not run two at once, and prefer `DIRECT_URL`.
- **Unverified items.** `next build` output tracing (finding 15), Playwright e2e on Postgres, and a real Supabase run (pooler latency, `en_US` collation, Storage bucket creation) were not tested.
- **PGlite.** It is single-process: local `next dev` and `db:*` scripts cannot run at the same time against `.data/pglite`. Stop the dev server first.
- **Not reviewed.** An untracked `.tc.tmp.cjs` at the repo root comes from an earlier step. It was not reviewed and should not be committed.
