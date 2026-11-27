/**
 * Structural executor shared by the raw SQL helpers of @kitstak/db (record links, deal facts,
 * program money inputs, WMS free stock). Every app hands in the Drizzle executor it already
 * has (node-postgres in Projects, CRM, Pulse and Portal; postgres-js or PGlite in WMS; or a
 * transaction of either). Only raw `sql` is used, so no host schema is needed. Never pass array
 * parameters (drivers disagree on them): build lists with `sqlList`.
 */
import { sql, type SQL } from 'drizzle-orm';

/** Structural subset of a Drizzle Postgres database or transaction. */
export interface Executor {
  execute(query: SQL): PromiseLike<unknown>;
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
}

/** Rows of an `execute()` result: node-postgres and PGlite return `{ rows }`, postgres-js an array. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

export async function queryRows<T>(db: Executor, statement: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(statement));
}

export async function queryFirst<T>(db: Executor, statement: SQL): Promise<T | undefined> {
  return (await queryRows<T>(db, statement))[0];
}

/** `(a, b, c)` for `in` clauses, portable across drivers. Callers must not pass an empty list. */
export function sqlList(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/** Same as `sqlList` but every value is cast to uuid. */
export function sqlUuidList(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  )})`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const ISO_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isIsoMonth = (value: unknown): value is string => typeof value === 'string' && ISO_MONTH_RE.test(value);

/** A `date` column as `YYYY-MM-DD` whatever the driver returns (string, or a Date at UTC midnight). */
export function isoDateOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : null;
}

/** A `timestamptz` as an ISO string whatever the driver returns. */
export function isoTimestampOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** A numeric or bigint column as a plain string (drivers return strings, numbers or bigints). */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '0';
  return typeof value === 'string' ? value : String(value);
}

export function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

/** The Postgres error inside a driver or Drizzle wrapper (Drizzle 0.45 wraps it in `cause`). */
export function pgErrorOf(error: unknown): { code?: string; constraint?: string; message?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : typeof candidate.constraint_name === 'string' ? candidate.constraint_name : undefined;
      return { code: candidate.code, constraint, message: typeof candidate.message === 'string' ? candidate.message : undefined };
    }
    current = candidate.cause;
  }
  return null;
}

const TTL_MS = 60_000;

/** A per executor cache with a one minute time to live (feature detection). */
export function ttlCache<V>(): {
  get(db: object): V | undefined;
  set(db: object, value: V): void;
  clear(db: object): void;
} {
  const store = new WeakMap<object, { readonly at: number; readonly value: V }>();
  return {
    get(db) {
      const hit = store.get(db);
      return hit && Date.now() - hit.at < TTL_MS ? hit.value : undefined;
    },
    set(db, value) {
      store.set(db, { at: Date.now(), value });
    },
    clear(db) {
      store.delete(db);
    },
  };
}
