/**
 * The bridge talks to the shared Postgres through whatever Drizzle executor the host app already
 * has (Portal, CRM, Projects, Pulse, Ledger: node-postgres; WMS: postgres-js or PGlite; a
 * transaction of either). Only raw `sql` is used, so no host schema is needed; result shapes
 * differ per driver and are normalized here. Same shape as `@kitstak/pulse-bridge`.
 */
import { sql, type SQL } from 'drizzle-orm';

/** Structural subset of a Drizzle Postgres database or transaction. */
export interface BridgeExecutor {
  execute(query: SQL): PromiseLike<unknown>;
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

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export interface CrewAvailability {
  /** The Crew tables exist in this database (`crew.people` is there). */
  readonly installed: boolean;
}

/** How long an answer about table presence is trusted (SPEC 8.1: 60 seconds). */
export const AVAILABILITY_TTL_MS = 60_000;
const cache = new WeakMap<object, { readonly at: number; readonly value: CrewAvailability }>();

/**
 * Whether the Crew schema exists in this database, `to_regclass('crew.people')` (cached for a
 * minute per executor). Never throws: any error reads as "not installed".
 */
export async function crewAvailability(db: BridgeExecutor, now: number = Date.now()): Promise<CrewAvailability> {
  const cached = cache.get(db);
  if (cached && now - cached.at < AVAILABILITY_TTL_MS) return cached.value;
  let value: CrewAvailability = { installed: false };
  try {
    const row = await queryOne<{ installed: boolean }>(db, sql`select to_regclass('crew.people') is not null as installed`);
    value = { installed: row?.installed === true };
  } catch {
    value = { installed: false };
  }
  cache.set(db, { at: now, value });
  return value;
}

/** Test hook: forget cached availability. */
export function resetAvailabilityCache(db: BridgeExecutor): void {
  cache.delete(db);
}

/** True when a table exists (`schema.table`). Never throws. Not cached: used for tables added by later phases. */
export async function tableExists(db: BridgeExecutor, qualified: string): Promise<boolean> {
  try {
    const row = await queryOne<{ ok: boolean }>(db, sql`select to_regclass(${qualified}) is not null as ok`);
    return row?.ok === true;
  } catch {
    return false;
  }
}
