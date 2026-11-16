# SQLite → Postgres migration guide (binding for every module)

KitStaks WMS moves from SQLite (better-sqlite3, fully synchronous) to Postgres so it runs on
Vercel against the Supabase project "KitStak WMS". **Behaviour, data and API responses must stay
identical.** This guide is the contract module agents follow. Foundation owns everything in §1–§2;
modules convert their own files (BUILD_PLAN 0.1 ownership) with §3–§7.

Contents: 1 Platform · 2 Foundation API · 3 Conversion rules (+ codemod) · 4 Transactions & write
lock · 5 SQL semantics checklist · 6 Tests · 7 Scripts & seeds · 8 Done checklist.

---

## 1. Platform (decided — do not redesign)

| Where | Driver | Notes |
|---|---|---|
| Runtime with `DATABASE_URL` (Vercel) | `postgres` (postgres-js) + `drizzle-orm/postgres-js` | Supabase pooler, **transaction mode**: `prepare: false`, `max` 3 (Vercel) / 5. Migrations are NOT applied at runtime. |
| Runtime without `DATABASE_URL` (local dev, scripts) | `@electric-sql/pglite` persisted at `.data/pglite` + `drizzle-orm/pglite` | Pending migrations applied on first open. Single process: a lock file (`.data/pglite.lock`) stops a second process (e.g. `db:seed` while `next dev` runs). |
| Tests | in-memory PGlite | `await createTestDb()` (§6). |

- Schema: `src/server/db/schema/*.ts` uses `drizzle-orm/pg-core`. Table/column names are unchanged.
  Ids and ISO-8601 timestamps stay `text`; `integer` stays `integer` (**int4: max 2,147,483,647**);
  `real` → `doublePrecision`; `bool()` → Postgres `boolean`; `json()` → `jsonb`.
- Migrations (`drizzle/`): `0000_postgres_baseline` (drizzle-kit), `0001_billing_period_guard`
  (port of the SQLite billing triggers, raises `KS_BILL_PERIOD_OVERLAP`), `0002_enable_rls` (RLS
  on every table, no policies: the app connects as the owner, which bypasses RLS; Supabase's anon /
  authenticated Data API sees nothing), `0003_rowid_columns` (see §5 "rowid").
  A schema change = edit the schema, `npm run db:generate`, and add the new table to an
  `ENABLE ROW LEVEL SECURITY` statement (the F1 test asserts every table has RLS). Tables the app also creates on demand (`scheduler_lease`, `scheduler_task_runs`, `pack_drafts`, `eod_auto_close_rules`) are created with RLS by `0004_runtime_tables_rls`; a new runtime `CREATE TABLE IF NOT EXISTS` must be added there too. Never `drizzle-kit push`.
- int8 (`COUNT(*)`, `SUM(int)`, bigint) is returned as a JS **number** on both drivers (postgres-js
  gets the same parser PGlite has). `numeric` (AVG, `ROUND(x::numeric, n)`, SUM of numeric) is a
  **string** on both: cast with `::float8` (or `.mapWith(Number)`).
- Every session runs in UTC (`SET TIME ZONE 'UTC'` on PGlite; Supabase defaults to UTC).
- Files: `src/server/files/files.ts` stores bytes through a `BlobStorage` adapter — local disk
  (`KITSTAK_FILES_DIR`, default `.data/files`) or Supabase Storage bucket `wms-files` when
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set. Every `FileStore` method is async.
- Scheduler: the in-process scheduler never starts on Vercel (`VERCEL` set). Vercel Cron
  (`vercel.json`, every minute — needs the Pro plan; on Hobby change it to a daily schedule) calls
  `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET`. Every task runs inside
  `withWriteTx`. A tick stops starting tasks after 4 minutes (`TICK_BUDGET_MS`), so it ends
  cleanly before Vercel's 300 s limit; tasks it did not reach stay due.
- Network distance: the code issues queries one at a time, so request time is roughly
  (queries x round trip to the database). `vercel.json` pins the functions to `sfo1`, the same
  AWS region as the Supabase project (`us-west-1`). If the database moves, move `regions` with
  it: from `iad1` every query cost about 70 ms and the scheduler could not finish a tick.
- Driver patch: `patches/postgres@3.4.9.patch` (repo root, applied by pnpm) stops postgres-js
  from spending a second round trip on every parameterised query when `prepare: false`.
- Writer gate: one queue per warehouse and server instance (`withWriteTx`), so a long write
  in one warehouse never answers another warehouse's writes with BUSY.
- Env (`.env.example`): `DATABASE_URL`, `DIRECT_URL`, `DATABASE_POOL_MAX`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `KITSTAK_FILES_DIR`, `SESSION_SECRET`, `CRON_SECRET`, `SCHEDULER_ENABLED`.
- `next.config.ts`: `serverExternalPackages: ["@electric-sql/pglite", "postgres"]`.

## 2. Foundation API (stable — build on it)

```ts
import type { AppDb, AppTx } from "@/server/api/db";   // AppDb = PgDatabase<PgQueryResultHKT, AppSchema>; a tx IS an AppDb
import { getAppDb } from "@/server/api/db";             // async, lazy singleton (also: getDb/closeDb from "@/server/db")
import {
  dbAll, dbGet, dbRun,                // raw SQL (mandatory for every raw sql``)
  rowCount,                           // affected rows of a builder write (replaces .run().changes)
  withWriteTx, takeWriteLock,         // write transactions (§4)
  bestEffort, inSavepoint,            // savepoints: failures must not poison the enclosing tx
  mapSeq, flatMapSeq, filterSeq, forEachSeq, someSeq, everySeq, findSeq,  // sequential async array helpers
  pgErrorCode, isUniqueViolation, isForeignKeyViolation, pgConstraintOf, dbErrorMessage,
  PG_UNIQUE_VIOLATION, PG_FOREIGN_KEY_VIOLATION, PG_RAISE_EXCEPTION,
  sqlNowIso, isoText, asTimestamp, daysBetween, ilikeSql, chunked,
} from "@/server/db/sql";
```

Already converted by foundation and **async** (always `await` them): `defineRoute` (handlers may
be async), `auth/*` (`writeAudit`, `buildAuthContext`, `getAuthContext`, `loadPermissions`,
`getScope`, `requirePagePermission`, `issueSession`, `resolveSession`, `revoke*`,
`bumpSessionVersion`, `listActiveSessions`, `hitRateLimit`, `authenticate`, `getPasswordPolicy`,
`requestPasswordReset`, `resetPassword`), `query/paginate` (`await paginate(q, async () => n, page)`),
all of `domain/**` (`ledger.*`, `stateMachines` stay sync — pure, `sequences.next/peek/nextLpNumber/billNumber`,
`change-log` `record*`/`resolveFieldValue`/`lastFromValue`, `allocation`, `jobs`, `tasks`, `orders`,
`shipping`, `putaway`, `atp`, `notify`, `workflows`, task handlers — `TaskHandler` returns a Promise),
`files` (`FileStore` methods), `exports/runner`, `imports/pipeline` (`ImportHandler.apply` may return a
Promise), `scheduler/*`, `search/*`, `workflows/actions/*` (`WorkflowActionExecutor` may return a Promise),
`shell/*`, `http/order-exists`, seeds (`src/server/db/seed/**`).

`scopedWhere`, `assertInScope`, `compileFilters`, `compileQuickSearch`, `compileSort`, `qualified`,
`parseGridQuery`, envelope helpers, `stateMachines.*.transition` are pure and stay synchronous.

**Rule of thumb: every function that takes a `db`/`tx` (or calls `getAppDb`) is `async` and every
caller awaits it.** Awaiting a still-synchronous function from another module is harmless, so
await cross-module DB calls even before their owner converts them.

## 3. Conversion rules

### 3.1 The codemod (run it first, then review)

```
node --max-old-space-size=8192 scripts/pg-codemod.mjs src/server/repositories/orders-list.ts src/app/api/orders tests/unit/orders-outbound
```

Type-aware (TypeScript program over `tsconfig.json`), edits only the paths given (files or
directories), repeats passes until stable, then prints WARNINGS (manual work) and the remaining
tsc errors of those files. What it does: `.get/.all/.run` (§3.2), raw `db.get/all/run(sql)` →
`dbGet/dbAll/dbRun`, `db.transaction` → `withWriteTx`, awaits calls of functions that were
synchronous in git HEAD (and of not-yet-converted functions that take a db/tx), awaits floating
promise statements in server code, marks functions async (+ `Promise<T>` return types), turns
`arr.map/flatMap/filter/forEach/some/every/find(asyncCb)` and `Array.from(x, asyncCb)` into the
sequential helpers, `ReturnType<typeof dbFn>` → `Awaited<…>`, and
`expect(() => x).toThrow()` → `await expect(async () => x).rejects.toThrow()`.

**Foundation already ran it over all of `src/`, `tests/` and `scripts/`** (the async ripple across
modules is done). Re-run it on your own paths after hand edits (idempotent). It never touches SQL
text — §5 is your job — and it cannot see interface/type declarations of callbacks (fix those by
hand when tsc reports `Promise<X>` is not assignable to `X`).

### 3.2 Query builder (before → after)

```ts
// .get()  — first row or undefined
const po = tx.select().from(t).where(eq(t.id, id)).get();
const [po] = await tx.select().from(t).where(eq(t.id, id)).limit(1);          // or (await q.limit(1))[0]

// .all()
const rows = db.select().from(t).where(w).orderBy(asc(t.code)).all();
const rows = await db.select().from(t).where(w).orderBy(asc(t.code));

// .run()
tx.update(t).set({ status }).where(eq(t.id, id)).run();
await tx.update(t).set({ status }).where(eq(t.id, id));

// .run().changes
const n = db.delete(t).where(w).run().changes;
const n = rowCount(await db.delete(t).where(w));

// .returning().get()  (insert / update / delete)
const row = tx.insert(t).values(v).returning().get();
const [row] = await tx.insert(t).values(v).returning();
```

A query that already has `.limit(n)` must not get a second `.limit()`; use `(await q)[0]`.
`.returning()` keeps working; `last_insert_rowid()` does not exist — use `returning`.

### 3.3 Raw SQL

```ts
db.all<Row>(sql`SELECT ...`)          →  await dbAll<Row>(db, sql`SELECT ...`)
db.get<Row>(sql`SELECT ... LIMIT 1`)  →  await dbGet<Row>(db, sql`SELECT ... LIMIT 1`)
db.run(sql`UPDATE ...`)               →  await dbRun(db, sql`UPDATE ...`)        // .changes → .rowCount
```

Never call `db.execute()` and read its result directly: postgres-js returns an array, PGlite
`{ rows }`; the helpers normalise both. **Postgres folds unquoted identifiers to lower case:**
`SELECT on_hand AS onHand` returns the key `onhand` — quote camelCase aliases: `AS "onHand"`.

### 3.4 Functions, callbacks, async ripple

- A function containing `await` becomes `async`; its return type `T` becomes `Promise<T>`; every
  caller awaits. Interfaces / function types for DB callbacks change too (`(): T` → `(): Promise<T>`
  or `T | Promise<T>` when sync implementations remain).
- `arr.map(row => db…)` must not become `arr.map(async …)` (an array of promises). Use the
  sequential helpers: `await mapSeq(arr, async (row) => …)` (also `flatMapSeq`, `filterSeq`,
  `forEachSeq`, `someSeq`, `everySeq`, `findSeq`) or a `for…of` loop. **Never `Promise.all` over
  writes inside a transaction** (interleaving breaks sequence/ledger ordering); `Promise.all` is
  fine only for independent reads outside a transaction.
- `.reduce` / `.sort` with DB work in the callback: rewrite as a `for…of` loop.
- No floating promises: every promise is awaited, returned, or explicitly `void`ed with a reason.
  `tsc` does not catch a missing `await` on a statement — read the diff.
- Getters, constructors and type predicates cannot be async: refactor them into async functions.
- React server components may be `async` (they already are when they call `getAuthContext()`);
  client components never touch the DB.
- There is no synchronous `db` export: `import { db } from "@/server/db"` → `const db = await getAppDb()`.

## 4. Transactions and the write lock

`defineRoute` runs every mutation (non-GET, or `transaction: true`) as

```ts
await db.transaction(async (tx) => { await takeWriteLock(tx); return await handler(ctx(tx)); });
```

`takeWriteLock` = `SELECT pg_advisory_xact_lock(<one app-wide key>)`: writers are serialised
exactly as with SQLite, so allocation / ledger / sequence / "check then insert" logic keeps its
correctness without per-site locking. The lock is re-entrant inside one transaction.

- **Use only `ctx.db` (the transaction) inside a handler** — never `getAppDb()` / a module-level db.
  On PGlite a second handle deadlocks behind the open transaction; on Postgres it would not see
  the uncommitted rows (and would wait on the lock).
- Every other write path (scheduler task — the runner already wraps it, cron, imports — the
  pipeline wraps each row in a savepoint, seeds, scripts, background tasks, one-off repairs) uses
  `await withWriteTx(db, async (tx) => { … })`. Nested `withWriteTx` / `db.transaction` inside a
  transaction is a SAVEPOINT.
- `db.transaction((tx) => {...})` (sync) → `await withWriteTx(db, async (tx) => {...})` (the codemod does this).
- **A failed statement aborts the whole Postgres transaction.** SQLite let you `try { insert } catch {}`
  and continue; Postgres then fails every later statement with "current transaction is aborted".
  Wrap any statement whose DB error you catch in a savepoint: `await inSavepoint(tx, (sp) => …)`
  (rethrows) or `await bestEffort(tx, (sp) => …)` (swallows). Errors thrown in JS (DomainError /
  AppError before any failing SQL) do not need this.
- Driver errors are wrapped by drizzle (`DrizzleQueryError`, message "Failed query: …", driver error
  in `.cause`). Match SQLSTATE, never SQLite text: `isUniqueViolation(e)` (23505, was
  `SQLITE_CONSTRAINT_UNIQUE` / "UNIQUE constraint failed"), `isForeignKeyViolation(e)` (23503),
  `pgErrorCode(e) === PG_RAISE_EXCEPTION` + `dbErrorMessage(e)` for trigger RAISEs
  (`KS_BILL_PERIOD_OVERLAP`). `SQLITE_BUSY` / "database is locked" retries are dead code: delete them.
- Long external calls (carrier / channel HTTP) inside a write transaction hold the global lock —
  same as before; do not add new ones.

## 5. SQL semantics checklist (review EVERY raw `sql` against it)

| SQLite | Postgres | Notes |
|---|---|---|
| `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, `datetime('now')` | `sqlNowIso` / `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` | Must produce the same ISO text the app writes (`nowIso()`). `datetime('now')` (`YYYY-MM-DD HH:MM:SS`) → `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`. |
| `date(x)`, `strftime('%Y-%m-%d', x)` | `substr(x, 1, 10)` (ISO text) or `to_char((x)::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD')` | Prefer `substr` on ISO text: identical and index-friendly. |
| `strftime('%H', x)` / `'%w'` / `'%Y-%m'` | `to_char((x)::timestamptz AT TIME ZONE 'UTC','HH24')` / `EXTRACT(DOW FROM …)::int` / `'YYYY-MM'` | `%w` Sunday=0 = `DOW`. |
| `julianday(b) - julianday(a)` | `daysBetween(a, b)` = `EXTRACT(EPOCH FROM (b::timestamptz - a::timestamptz))/86400.0` | Result float8. |
| `datetime(x, '+3 days')` | `isoText(asTimestamp(x) + interval '3 days')` | Keep ISO text output. |
| `json_extract(c, '$.a')` | `c ->> 'a'` (text) / `c -> 'a'` (jsonb); nested `c #>> '{a,b}'` | `->>` is TEXT: cast numbers (`(c->>'n')::float8`), booleans (`(c->>'b')::boolean`). json columns are `jsonb` now. |
| `json_each(c)` | `jsonb_array_elements(c) AS e(value)` / `jsonb_each(c)` | `value` is jsonb; `jsonb_array_elements_text` for text. |
| `json_group_array(x)` / `json_object(...)` | `jsonb_agg(x)` (+ `COALESCE(…,'[]'::jsonb)`) / `jsonb_build_object(...)` | `jsonb_agg` of nothing is NULL. |
| `json(x)` / `json_array_length` | `x::jsonb` / `jsonb_array_length` | |
| `group_concat(x, ',')` | `string_agg(x, ',')` (cast non-text: `x::text`) | Add `ORDER BY` inside if order matters: `string_agg(x, ',' ORDER BY x)`. |
| `ifnull(a,b)` / `iif(c,a,b)` | `coalesce(a,b)` / `CASE WHEN c THEN a ELSE b END` | |
| scalar `max(a,b)` / `min(a,b)` | `GREATEST(a,b)` / `LEAST(a,b)` | Aggregate MAX/MIN unchanged. |
| `instr(a,b)` / `printf('%05d',n)` / `substr` | `strpos(a,b)` / `lpad(n::text,5,'0')` / `substr` | |
| `INSERT OR IGNORE` / `INSERT OR REPLACE` | `.onConflictDoNothing()` / `.onConflictDoUpdate({ target, set })` | Raw: `ON CONFLICT DO NOTHING` / `ON CONFLICT (cols) DO UPDATE SET …`. |
| `x LIKE 'abc%'` | `x ILIKE 'abc%'` | **SQLite LIKE is case-insensitive; Postgres LIKE is case-sensitive.** Every grid search / filter / picker / quick search uses ILIKE (`compileFilters`/`compileQuickSearch` already do). Drizzle `like()` → `ilike()`. `GLOB` → `~` regex. Postgres LIKE/ILIKE use backslash as the default escape (SQLite had none): user input needs `ESCAPE ''` (keeps SQLite behaviour) or doubled backslashes (`likePattern`), or `escapeLike` + `ESCAPE ''`. |
| `COLLATE NOCASE` / `lower(x) = lower(y)` | `lower(x) = lower(y)` / `ILIKE` | Unique indexes with NOCASE → `lower()` expression index. |
| `GROUP BY a` with other bare columns selected | list every non-aggregated selected column (or aggregate it) | Postgres rejects bare columns (SQLite picked an arbitrary row). PK grouping allows the table's columns. |
| `ORDER BY x` (x nullable) | `x ASC NULLS FIRST` / `x DESC NULLS LAST` | **SQLite: NULLs first ascending, last descending; Postgres: the opposite.** Spell it out wherever order is visible (grids, exports, "latest" pickers, FEFO). `compileSort` does. Query-builder code imports `asc`/`desc` from `@/server/db/order` (not `drizzle-orm`): they add the SQLite placement for nullable columns and SQL expressions and keep plain clauses on NOT NULL columns. |
| no `ORDER BY` | add one | SQLite returned rowid (insertion) order; Postgres heap order changes after updates. Any list, export or "first match" that relied on insertion order needs an explicit `ORDER BY` (`created_at, id`, or `rowid` where §rowid applies). |
| `COUNT(*)`, `SUM(int)` | int8 → JS number (configured) | OK as-is. `SUM(double)` → float8 number. |
| `AVG(x)`, `ROUND(x, 2)`, `SUM(numeric)` | `AVG(x)::float8`, `ROUND((x)::numeric, 2)::float8` | **`round(double precision, int)` does not exist**; numeric comes back as a STRING. |
| `CAST(x AS REAL)` / `x * 1.0` | `(x)::float8` | |
| `CAST(2.7 AS INTEGER)` → 2 (truncates) | `trunc(x)::int` | Postgres `::int` ROUNDS (3). |
| integer / integer | unchanged (integer division in both) | |
| `a || b` | unchanged | NULL propagates in both. |
| `bool_col = 1` / `= 0`, `SUM(bool_col)` | `bool_col` / `NOT bool_col` / `= true`; `SUM(bool_col::int)` / `COUNT(*) FILTER (WHERE bool_col)` | Boolean expressions now return `true/false`, not `1/0`: fix code doing `row.flag === 1`, `Number(x)`, `if (n > 0)` on a raw boolean select; `sql<number>\`a = b\`` → `sql<boolean>` or `(a = b)::int`. |
| `'abc' = 123`, `text_col = 5`, `x <> ''` on an integer | explicit casts | Postgres never coerces between text and numbers: `= ''` on an integer column is an ERROR. |
| `"string literal"` (double quotes) | `'string literal'` | Double quotes are identifiers in Postgres. |
| `sqlite_master`, `PRAGMA ...`, `VACUUM`, `ATTACH` | `information_schema` / `pg_catalog`; remove PRAGMAs | |
| `rowid` | only `change_log`, `purchase_order_lines`, `purchase_order_serials` have a real `rowid` (identity, migration 0003, not in the Drizzle schema) | Use `sql\`"change_log"."rowid"\``. Elsewhere order by `created_at, id`. |
| `last_insert_rowid()`, `changes()` | `.returning()`, `rowCount()` | |
| bound-parameter limit (SQLite 32766) | 65535 per statement | Batch multi-row inserts with `chunked(rows, 1000)` (wide tables: 500). |
| `IN ()` with an empty list | guard in JS | drizzle `inArray(col, [])` is fine (renders `false`); a raw `IN (${sql.join([])})` is a syntax error. |
| text sorting (`ORDER BY name`) | collation | SQLite compared bytes (`'B' < 'a'`). Supabase uses `en_US.UTF-8` (case-insensitive-ish ordering), PGlite `C`. Where an exact byte order is required, `ORDER BY x COLLATE "C"`. Do not "fix" grid ordering otherwise; flag differences in your notes. |
| timestamps | text ISO stays text | Compare ISO text lexicographically as before; cast with `::timestamptz` only for arithmetic. |

Also: a correlated subquery referencing the outer table must use `qualified(table)` (unchanged rule);
reserved words as identifiers (`user`, `order`, `position`, `limit`) must be quoted in raw SQL.

## 6. Tests

```ts
import { createTestDb, type TestDb } from "../../setup/test-db";
let t: TestDb;
beforeEach(async () => { t = await createTestDb(); });
afterEach(() => t.close());                              // async; returns a Promise

// domain world (tests/unit/foundation/domain/fixtures.ts)
let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => w.close());
```

- `createTestDb()` is async and returns `{ db, pg, close }`: an empty, fully migrated in-memory
  PGlite. Each worker migrates once and loads a dump (~150 ms); `close()` truncates and pools the
  instance (~40 ms reuse). `t.sqlite` is gone: use `t.pg.query("…", [params])` / `t.pg.exec("…")`
  for plain SQL (Postgres placeholders are `$1`, not `?`).
- Synchronous throws become rejections:
  `expect(() => fn()).toThrow(X)` → `await expect(async () => await fn()).rejects.toThrow(X)`
  (the codemod does this). `expect(() => …).not.toThrow()` → just `await fn()`.
- DB error assertions: `toThrow(/UNIQUE constraint/)` → `expect(pgErrorCode(err)).toBe(PG_UNIQUE_VIOLATION)`;
  drizzle error messages start with "Failed query:" — match the domain message, not driver text.
- Ordering assertions that relied on insertion order need an `ORDER BY` in the code under test (§5).
- `vi.mock("@/server/api/db", () => ({ getAppDb: async () => current.db }))` keeps working.
- Booleans read through raw SQL are `true/false`; `numeric` values are strings (§5).

Run one module's unit tests:

```
npx vitest run tests/unit/<module-id>              # e.g. tests/unit/orders-outbound
npx vitest run tests/unit/<module-id>/some.test.ts -t "test name"
npx tsc --noEmit -p . | grep -E "^(src/server/repositories/orders|src/app/api/orders|tests/unit/orders-outbound)"
node scripts/pg-codemod.mjs <your paths>           # prints remaining type errors for exactly your files
```

## 7. Scripts and seeds

- `npm run db:migrate` — applies `drizzle/` to `DIRECT_URL` (else `DATABASE_URL`) under a session
  advisory lock, or to local PGlite when neither is set.
- `npm run db:seed` / `db:fixtures` / `db:verify` / `db:drop` / `db:reset` — local PGlite by default,
  `DATABASE_URL` when set. Stop `next dev` first when using PGlite (single process).
- A script opens the database with `await getDb()` (or `openDatabase()`), writes inside
  `withWriteTx`, and ALWAYS ends with `await closeDb()` (flushes PGlite to disk, drains the pool).
  No top-level `db` / sync calls; wrap the body in `async function main()`.

## 8. Done checklist per module

1. `node scripts/pg-codemod.mjs <owned paths>` reports 0 type errors and no unhandled warnings.
2. No `better-sqlite3`, `drizzle-orm/sqlite-core`, `.get()`/`.all()`/`.run()`, `db.get/all/run(sql)`,
   `.changes`, `t.sqlite`, `SQLITE_*` / "UNIQUE constraint failed" in owned files.
3. Every raw `sql` in owned files reviewed against §5 (LIKE→ILIKE, quoted camelCase aliases,
   GROUP BY, NULLS FIRST/LAST, numeric casts, booleans, JSON operators, explicit ORDER BY).
4. Every write outside `defineRoute` runs in `withWriteTx`; no DB error is caught inside a
   transaction without a savepoint; no floating promises; no `Promise.all` over writes.
5. `npx vitest run tests/unit/<module-id>` green; e2e + `npm run db:verify` green.

## 9. State handed to the modules (foundation run, 2026-11-10)

- Foundation (schema, migrations, drivers, `sql.ts`, `define-route`, auth, query, all of
  `src/server/domain/**` except the module task-handler stubs, files, exports, imports pipeline,
  scheduler, search registry/match, shell, seeds, `platform-*` repositories, F7 routes,
  `scripts/{db-reset,verify-ledger,seed-fixtures,lib/drop-all}.ts`, `tests/setup/**`) is converted:
  `npx vitest run tests/unit/foundation` is green (70 files / 647 tests), and
  `npm run db:reset && npm run db:verify` reconciles on local PGlite (seed ≈ 65 s).
- The codemod has been applied to the whole tree. `npx tsc --noEmit` reports ~95 errors, all in
  module files. Module unit suites after the mechanical pass: ~82 % of tests pass; the rest are SQL
  semantics (§5) and a few callback/interface types.
- Hot spots seen in the failures (check these first):
  - `group_concat`, `json_each`, `GLOB`, scalar `MAX(a,b)`, `= 1` on booleans, `IIF`, `strftime`.
  - Unquoted camelCase aliases in raw SQL (`AS labelCreatedAt` → key `labelcreatedat` → `undefined`
    → "Invalid time value" further down).
  - SQLite's "bare column next to MIN()/MAX()" trick: `SELECT x.id, MIN(x.code) … GROUP BY y` →
    `(array_agg(x.id ORDER BY x.code))[1]`.
  - M11 `billing-engine.ts` still creates the SQLite billing triggers at runtime: delete that code;
    migration `0001_billing_period_guard` owns the trigger (match `KS_BILL_PERIOD_OVERLAP` with
    `dbErrorMessage(e)` / `pgErrorCode(e) === PG_RAISE_EXCEPTION`).
  - M04 `returns.ts` reads `pragma_table_info(...)`: use `information_schema.columns`.
  - M03 `jobs-read-retry.ts` retries `SQLITE_BUSY`: dead code under Postgres — remove.
  - `rowid` exists only on `change_log`, `purchase_order_lines`, `purchase_order_serials`.
  - A test that hangs (stations-returns did once) is almost always a query on a SECOND handle
    (`getAppDb()` / a module-level db / a mocked db) while a transaction is open on PGlite: pass
    the transaction down instead.
- Text sort order: SQLite compared bytes; Supabase's default collation is `en_US.UTF-8`. Grid
  sorting on text may differ in case/punctuation order between PGlite (`C`) and Supabase. Not
  changed globally (decision for integration); add `COLLATE "C"` only where a test or a
  byte-exact order requires it.
