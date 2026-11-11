/**
 * `asc()` / `desc()` with SQLite's NULL placement.
 *
 * SQLite sorts NULLs as the smallest value: FIRST ascending, LAST descending. Postgres does
 * the opposite (NULLS LAST ascending, NULLS FIRST descending). Every ORDER BY that ran on
 * SQLite therefore changes order (FEFO picks, grid sorts, pagination) on a nullable column
 * unless the placement is spelled out. Import these instead of drizzle's:
 *
 *   import { asc, desc } from "@/server/db/order";
 *
 * A NOT NULL column keeps the plain drizzle clause (so it still matches its btree index);
 * a nullable column or an arbitrary SQL expression gets `NULLS FIRST` (asc) / `NULLS LAST` (desc).
 */
import { asc as pgAsc, Column, desc as pgDesc, is, sql, type AnyColumn, type SQL, type SQLWrapper } from "drizzle-orm";

const notNull = (target: AnyColumn | SQLWrapper): boolean => is(target, Column) && (target as Column).notNull;

/** Ascending, NULLs first (SQLite order). */
export function asc(target: AnyColumn | SQLWrapper): SQL {
  return notNull(target) ? pgAsc(target) : sql`${pgAsc(target)} NULLS FIRST`;
}

/** Descending, NULLs last (SQLite order). */
export function desc(target: AnyColumn | SQLWrapper): SQL {
  return notNull(target) ? pgDesc(target) : sql`${pgDesc(target)} NULLS LAST`;
}
