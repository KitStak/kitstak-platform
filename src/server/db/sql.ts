/**
 * Raw-SQL helpers (mandatory for every raw `sql` query; docs/POSTGRES_MIGRATION.md).
 *
 * The two drivers return raw results differently: postgres-js resolves to a row ARRAY
 * (with `.count`), PGlite to `{ rows, affectedRows }`. These helpers normalise both, so
 * code never touches `db.execute()` results directly.
 *
 *   const rows = await dbAll<{ id: string; qty: number }>(tx, sql`SELECT id, qty::int AS qty FROM ...`);
 *   const one  = await dbGet<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM ...`);
 *   const { rowCount } = await dbRun(tx, sql`UPDATE ... SET ...`);
 *
 * Postgres folds unquoted identifiers to lower case: camelCase aliases MUST be quoted
 * (`AS "billNumber"`), or the row key comes back as `billnumber`.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";

/** Rows of a raw `db.execute()` / query-builder result, whichever driver produced it. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === "object") {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/**
 * Rows affected by a write (UPDATE/DELETE/INSERT without RETURNING), for either driver.
 * Replaces better-sqlite3's `.run().changes`:
 *   rowCount(await db.update(t).set(...).where(...))
 */
export function rowCount(result: unknown): number {
  if (Array.isArray(result)) {
    const count = (result as { count?: unknown }).count;
    return typeof count === "number" ? count : result.length;
  }
  if (result !== null && typeof result === "object") {
    const affected = (result as { affectedRows?: unknown }).affectedRows;
    if (typeof affected === "number") return affected;
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length;
  }
  return 0;
}

/** All rows of a raw query (was `db.all<T>(sql)`). */
export async function dbAll<T = Record<string, unknown>>(db: AppDb, query: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

/** First row of a raw query, or undefined (was `db.get<T>(sql)`). Add `LIMIT 1` yourself when it matters. */
export async function dbGet<T = Record<string, unknown>>(db: AppDb, query: SQL): Promise<T | undefined> {
  return (await dbAll<T>(db, query))[0];
}

/** Executes a raw statement (was `db.run(sql)`); `rowCount` replaces `.changes`. */
export async function dbRun(db: AppDb, query: SQL): Promise<{ readonly rowCount: number }> {
  return { rowCount: rowCount(await db.execute(query)) };
}

/**
 * The one app-wide advisory-lock key. Every write transaction takes it first, which
 * reproduces SQLite's single-writer semantics (allocation, ledger, sequences and
 * "check then insert" logic stay correct without per-site locking).
 */
export const WRITE_LOCK_KEY = 7_202_611_501;

/** How long a writer waits for the app write lock (and its in-process turn) before giving up with BUSY. */
export const WRITE_LOCK_WAIT_MS = 20_000;
const WRITE_LOCK_POLL_MS = 50;

function busyError(): AppError {
  return new AppError("BUSY", "The system is busy finishing another change. Please try again in a moment.", { headers: { "Retry-After": "5" } });
}

/**
 * Serialises writers: waits until no other write transaction holds the app lock. Transaction-scoped
 * and re-entrant. Polls `pg_try_advisory_xact_lock` instead of blocking in the database, so a
 * stuck or very long writer makes later writers fail fast with BUSY (503) rather than hang forever.
 */
export async function takeWriteLock(tx: AppDb, waitMs: number = WRITE_LOCK_WAIT_MS): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const row = await dbGet<{ locked: boolean }>(tx, sql`SELECT pg_try_advisory_xact_lock(${sql.raw(String(WRITE_LOCK_KEY))}) AS locked`);
    if (row?.locked) return;
    if (Date.now() >= deadline) throw busyError();
    await new Promise((resolve) => setTimeout(resolve, WRITE_LOCK_POLL_MS));
  }
}

/**
 * Per-process writer gate. Only one write transaction per server instance may hold (or wait
 * for) a pooled connection at a time. Without it, a few writers queued behind the app lock
 * each pin a connection, the small pool (3 on Vercel) runs dry and every READ stalls too:
 * pages sit on "Still loading" while one long write runs.
 */
const GATE_KEY = Symbol.for("kitstak.writeGate");
type GateHolder = { tail: Promise<void> };
function gate(): GateHolder {
  const g = globalThis as unknown as Record<symbol, GateHolder | undefined>;
  return (g[GATE_KEY] ??= { tail: Promise.resolve() });
}

async function enterWriteGate(waitMs: number): Promise<() => void> {
  const holder = gate();
  const previous = holder.tail;
  let release: () => void = () => {};
  holder.tail = new Promise<void>((resolve) => { release = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), waitMs); });
  const outcome = await Promise.race([previous.then(() => "ready" as const), timedOut]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    // Give up our place: pass the turn on as soon as the writer ahead of us finishes.
    void previous.then(release);
    throw busyError();
  }
  return release;
}

/** True for a drizzle transaction/savepoint handle (as opposed to the root database). */
function isTransaction(db: AppDb): boolean {
  return typeof (db as { rollback?: unknown }).rollback === "function";
}

/**
 * Runs `fn` in a transaction that holds the app write lock. Use for EVERY write path that
 * is not a `defineRoute` mutation (scheduler jobs, cron tick, imports, seeds, scripts,
 * background tasks). Called with an open transaction it nests as a savepoint (the lock is
 * re-entrant within one transaction) and skips the in-process gate, which the outer
 * transaction already holds or deliberately bypassed.
 */
export async function withWriteTx<T>(db: AppDb, fn: (tx: AppDb) => Promise<T>): Promise<T> {
  const run = (): Promise<T> =>
    db.transaction(async (tx) => {
      await takeWriteLock(tx);
      return await fn(tx);
    });
  if (isTransaction(db)) return run();
  const release = await enterWriteGate(WRITE_LOCK_WAIT_MS);
  try {
    return await run();
  } finally {
    release();
  }
}

export type BestEffortResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/**
 * Runs `fn` in a savepoint (or its own transaction when `db` is not a transaction) and
 * swallows its failure. In Postgres a failed statement aborts the WHOLE enclosing
 * transaction, so a "best effort" write (audit row, last-seen touch, optional log) that
 * used to sit in a bare try/catch must go through this instead.
 */
export async function bestEffort<T>(db: AppDb, fn: (tx: AppDb) => Promise<T>): Promise<BestEffortResult<T>> {
  try {
    return { ok: true, value: await db.transaction((sp) => fn(sp)) };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

/**
 * Like `bestEffort` but rethrows: runs `fn` in a savepoint so that a caught failure leaves
 * the enclosing transaction usable. Use wherever code catches a DB error (unique violation,
 * trigger RAISE) inside a transaction and carries on.
 */
export async function inSavepoint<T>(db: AppDb, fn: (sp: AppDb) => Promise<T>): Promise<T> {
  return db.transaction((sp) => fn(sp));
}

// ── Driver errors ─────────────────────────────────────────────────────────────────────
// drizzle wraps driver errors in DrizzleQueryError ("Failed query: ...") with the
// postgres-js / PGlite error as `cause`. SQLite codes (SQLITE_CONSTRAINT_UNIQUE, "UNIQUE
// constraint failed") never occur any more: match SQLSTATE codes through these helpers.

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_NOT_NULL_VIOLATION = "23502";
export const PG_CHECK_VIOLATION = "23514";
/** RAISE EXCEPTION in a trigger / function. */
export const PG_RAISE_EXCEPTION = "P0001";

interface PgErrorLike {
  readonly code?: string;
  readonly message: string;
  readonly constraint?: string;
  readonly constraint_name?: string;
  readonly table?: string;
  readonly table_name?: string;
  readonly detail?: string;
}

/** The innermost driver error (follows `.cause`), or undefined when `error` is not a DB error. */
export function pgErrorOf(error: unknown): PgErrorLike | undefined {
  let e: unknown = error;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return e as PgErrorLike;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** SQLSTATE of a DB error (e.g. "23505"), or undefined. */
export function pgErrorCode(error: unknown): string | undefined {
  return pgErrorOf(error)?.code;
}

export const isUniqueViolation = (error: unknown): boolean => pgErrorCode(error) === PG_UNIQUE_VIOLATION;
export const isForeignKeyViolation = (error: unknown): boolean => pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION;

/** Driver message of a DB error (without drizzle's "Failed query: <sql>" wrapper), else the error message. */
export function dbErrorMessage(error: unknown): string {
  return pgErrorOf(error)?.message ?? (error instanceof Error ? error.message : String(error));
}

/** Constraint name of a unique / FK violation (both drivers), or undefined. */
export function pgConstraintOf(error: unknown): string | undefined {
  const e = pgErrorOf(error);
  return e?.constraint_name ?? e?.constraint;
}

// ── Sequential async array helpers ───────────────────────────────────────────────────
// Replacements for `arr.map(cb)` & co. when `cb` became async. They run ONE item at a time,
// in order, exactly like the old synchronous loop. Never use Promise.all over writes in a
// transaction: interleaved callbacks would reorder writes (sequence / ledger seq races).

export async function mapSeq<T, R>(items: Iterable<T>, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  for (const item of items) out.push(await fn(item, i++));
  return out;
}

export async function flatMapSeq<T, R>(items: Iterable<T>, fn: (item: T, index: number) => Promise<R | readonly R[]>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  for (const item of items) {
    const r = await fn(item, i++);
    if (Array.isArray(r)) out.push(...(r as readonly R[]));
    else out.push(r as R);
  }
  return out;
}

export async function filterSeq<T>(items: Iterable<T>, fn: (item: T, index: number) => Promise<unknown>): Promise<T[]> {
  const out: T[] = [];
  let i = 0;
  for (const item of items) if (await fn(item, i++)) out.push(item);
  return out;
}

export async function forEachSeq<T>(items: Iterable<T>, fn: (item: T, index: number) => Promise<unknown>): Promise<void> {
  let i = 0;
  for (const item of items) await fn(item, i++);
}

export async function someSeq<T>(items: Iterable<T>, fn: (item: T, index: number) => Promise<unknown>): Promise<boolean> {
  let i = 0;
  for (const item of items) if (await fn(item, i++)) return true;
  return false;
}

export async function everySeq<T>(items: Iterable<T>, fn: (item: T, index: number) => Promise<unknown>): Promise<boolean> {
  let i = 0;
  for (const item of items) if (!(await fn(item, i++))) return false;
  return true;
}

export async function findSeq<T>(items: Iterable<T>, fn: (item: T, index: number) => Promise<unknown>): Promise<T | undefined> {
  let i = 0;
  for (const item of items) if (await fn(item, i++)) return item;
  return undefined;
}

// ── SQLite → Postgres expression helpers ─────────────────────────────────────────────

/** Current UTC instant as ISO-8601 text, `2026-01-02T03:04:05.678Z` (was strftime('%Y-%m-%dT%H:%M:%fZ','now')). */
export const sqlNowIso: SQL<string> = sql<string>`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** ISO-8601 text of a `timestamptz` expression, same format as `nowIso()`. */
export function isoText(expr: SQL): SQL<string> {
  return sql<string>`to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** Parses an ISO text column/expression into `timestamptz` (for date arithmetic; was julianday/datetime). */
export function asTimestamp(expr: SQL | unknown): SQL {
  return sql`(${expr})::timestamptz`;
}

/** Fractional days between two ISO text expressions, `b - a` (was julianday(b) - julianday(a)). */
export function daysBetween(a: SQL | unknown, b: SQL | unknown): SQL<number> {
  return sql<number>`(EXTRACT(EPOCH FROM ((${b})::timestamptz - (${a})::timestamptz)) / 86400.0::float8)::float8`;
}

/** Case-insensitive LIKE (SQLite LIKE is case-insensitive for ASCII; Postgres LIKE is not). */
export function ilikeSql(expr: SQL | unknown, pattern: string): SQL<boolean> {
  return sql<boolean>`${expr} ILIKE ${pattern}`;
}

/** Splits rows into chunks for multi-row INSERTs (Postgres caps a statement at 65535 bind parameters). */
export function chunked<T>(rows: readonly T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
