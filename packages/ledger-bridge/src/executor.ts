/**
 * The bridge talks to the shared Postgres through whatever Drizzle executor the host app already
 * has (Ledger, Portal, CRM, Pulse and Projects: node-postgres; WMS: postgres-js or PGlite; a transaction of
 * either). Only raw `sql` is used, so no host schema is needed; result shapes differ per driver
 * and are normalized here.
 */
import { sql, type SQL } from 'drizzle-orm';

/** Structural subset of a Drizzle Postgres database or transaction. */
export interface BridgeExecutor {
  execute(query: SQL): PromiseLike<unknown>;
  transaction<T>(fn: (tx: BridgeExecutor) => Promise<T>): Promise<T>;
}

/** Rows of an `execute()` result: node-postgres/PGlite return `{ rows }`, postgres-js an array. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export async function query<T>(db: BridgeExecutor, statement: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(statement));
}

export async function queryOne<T>(db: BridgeExecutor, statement: SQL): Promise<T | undefined> {
  return (await query<T>(db, statement))[0];
}

/** `(a, b, c)` parameter list for `in` clauses (portable across drivers, unlike array params). */
export function list(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** A safe whole number from a bigint, numeric or count column; `null` stays `null`. */
export function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function toCount(value: unknown): number {
  return toInt(value) ?? 0;
}
