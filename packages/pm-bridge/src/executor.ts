/**
 * The bridge talks to the shared Postgres through whatever Drizzle executor the host app already
 * has (CRM: node-postgres, WMS: postgres-js or PGlite, a transaction of either). Only raw `sql`
 * is used, so no host schema is needed; result shapes differ per driver and are normalized here.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { BridgeAvailability } from './types';

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

const TTL_MS = 60_000;
const cache = new WeakMap<object, { readonly at: number; readonly value: BridgeAvailability }>();

/**
 * Whether the Projects tables exist in this database (cached for a minute per executor).
 * Never throws: any error reads as "not installed".
 */
export async function pmAvailability(db: BridgeExecutor): Promise<BridgeAvailability> {
  const cached = cache.get(db);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: BridgeAvailability = { installed: false, events: false };
  try {
    const row = await queryOne<{ installed: boolean; events: boolean }>(
      db,
      sql`select (to_regclass('pm.tasks') is not null and to_regclass('pm.integration_links') is not null) as installed,
                 to_regclass('pm.integration_events') is not null as events`,
    );
    value = { installed: row?.installed === true, events: row?.events === true };
  } catch {
    value = { installed: false, events: false };
  }
  cache.set(db, { at: Date.now(), value });
  return value;
}

/** Test hook: forget cached availability. */
export function resetAvailabilityCache(db: BridgeExecutor): void {
  cache.delete(db);
}
