/**
 * Grid-grammar compiler shared by the M03 list endpoints. A grid spec (pure field list
 * from `src/lib/grid-defs/jobs`) plus a field -> SQL map produce the WHERE and ORDER BY.
 * Every field the spec declares must have SQL; unknown filters/sorts fail VALIDATION.
 */
import { and, getTableName, sql, type Column, type SQL } from 'drizzle-orm';
import type { GridSpec } from '@/lib/grid-defs/jobs/shared';
import { compileFilters, compileQuickSearch, type FilterFieldDef } from '@/server/query/filters';
import type { GridQuery, SortSpec } from '@/server/query/grid-query';
import { compileSort } from '@/server/query/sort';

export type FieldSqlMap = Readonly<Record<string, SQL>>;

export interface CompiledGrid {
  readonly where: SQL | undefined;
  readonly orderBy: SQL[];
}

export function serverFilterDefs(spec: GridSpec, map: FieldSqlMap): FilterFieldDef[] {
  return spec.fields.map((f) => {
    const expr = map[f.field];
    if (!expr) throw new Error(`${spec.gridKey}: no SQL for filter field "${f.field}"`);
    return {
      key: f.field,
      label: f.label,
      type: f.type,
      sql: expr,
      nullable: true,
      ...(f.options ? { options: f.options } : {}),
    };
  });
}

export function compileGrid(
  query: GridQuery,
  spec: GridSpec,
  map: FieldSqlMap,
  options: {
    readonly defaultSort: readonly SortSpec[];
    readonly tiebreaker: SQL;
    readonly extra?: readonly (SQL | undefined)[];
  },
): CompiledGrid {
  const search = compileQuickSearch(
    query.q,
    query.qm,
    spec.searchFields.map((f) => map[f]).filter((x): x is SQL => Boolean(x)),
  );
  const filters = compileFilters(serverFilterDefs(spec, map), query.filters);
  const parts = [search, filters, ...(options.extra ?? [])].filter((p): p is SQL => p !== undefined);
  const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : and(...parts);
  const sortable = Object.fromEntries(spec.sortKeys.filter((k) => map[k]).map((k) => [k, map[k] as SQL]));
  const orderBy = compileSort(sortable, query.sort, {
    defaultSort: options.defaultSort,
    tiebreaker: options.tiebreaker,
  });
  return { where, orderBy };
}

/** `COALESCE(x, 0)` for correlated counts. */
export const n0 = (expr: SQL): SQL => sql`COALESCE((${expr}), 0)`;

/** Yes/No booleans exposed as 0/1 for the `bool` filter op. */
export const asBool = (expr: SQL): SQL => sql`(CASE WHEN ${expr} THEN 1 ELSE 0 END)`;

/**
 * Fully-qualified column (`"jobs"."id"`). Drizzle renders columns unqualified in single-table
 * selects, which inside a correlated subquery would bind to the inner table's column.
 */
export const qc = (column: Column): SQL => sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
