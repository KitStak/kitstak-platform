/**
 * Whitelisted server sort: only keys declared in `sortable` can be sorted on.
 * Unknown keys throw VALIDATION. A stable tiebreaker (usually the primary key) is appended.
 */
import { asc, desc, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { AppError } from "@/server/api/errors";
import type { SortSpec } from "./grid-query";

export type SortableMap = Readonly<Record<string, SQLiteColumn | SQL>>;

export interface SortOptions {
  /** Applied when the request has no sort. */
  readonly defaultSort?: readonly SortSpec[];
  /** Appended last for deterministic paging (e.g. the id column). */
  readonly tiebreaker?: SQLiteColumn | SQL;
  /** Put NULLs last regardless of direction (default true, Logiwa-like). */
  readonly nullsLast?: boolean;
}

export function compileSort(sortable: SortableMap, specs: readonly SortSpec[], options: SortOptions = {}): SQL[] {
  const effective = specs.length > 0 ? specs : options.defaultSort ?? [];
  const nullsLast = options.nullsLast ?? true;
  const clauses = effective.flatMap((spec): SQL[] => {
    const target = Object.prototype.hasOwnProperty.call(sortable, spec.field) ? sortable[spec.field] : undefined;
    if (!target) {
      throw new AppError("VALIDATION", `Cannot sort by "${spec.field}"`, { fieldErrors: { sort: [`Unknown sort field "${spec.field}"`] } });
    }
    const order = spec.dir === "desc" ? desc(target) : asc(target);
    return nullsLast ? [sql`(${target} IS NULL)`, order] : [order];
  });
  return options.tiebreaker ? [...clauses, asc(options.tiebreaker)] : clauses;
}
