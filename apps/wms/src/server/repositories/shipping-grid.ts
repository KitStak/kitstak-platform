/**
 * M02 grid-grammar compiler: turns a parsed `GridQuery` plus a module grid definition
 * (`src/lib/grid-defs/shipping/**`) and a field → SQL map into WHERE / ORDER BY clauses.
 * Only declared fields filter or sort (whitelist); values are always bound parameters.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { ShippingField } from '@/lib/grid-defs/shipping/common';
import { compileFilters, compileQuickSearch, type FilterFieldDef } from '@/server/query/filters';
import type { GridQuery, SortSpec } from '@/server/query/grid-query';
import { compileSort } from '@/server/query/sort';

export type FieldSqlMap = Readonly<Record<string, SQL>>;

export interface GridSpec {
  readonly fields: readonly ShippingField[];
  readonly sqlFor: FieldSqlMap;
  readonly searchFields: readonly string[];
  readonly sortFields: readonly string[];
  readonly defaultSort: readonly SortSpec[];
  readonly tiebreaker: SQL;
  /** Fields stored as YYYY-MM-DD. */
  readonly dateOnlyFields?: readonly string[];
}

export interface CompiledGrid {
  readonly where: SQL | undefined;
  readonly orderBy: SQL[];
  readonly page: number;
  readonly pageSize: number;
  readonly offset: number;
}

function exprFor(spec: GridSpec, field: string): SQL {
  const expr = spec.sqlFor[field];
  if (!expr) throw new Error(`shipping-grid: no SQL for field "${field}"`);
  return expr;
}

export function filterDefsOf(spec: GridSpec): FilterFieldDef[] {
  return spec.fields.map((f) => ({
    key: f.field,
    label: f.label,
    // Facet fields are enum in the UI once options load; accept both enum and text operators.
    type: f.facet ? 'text' : f.type,
    sql: exprFor(spec, f.field),
    nullable: true,
    dateOnly: spec.dateOnlyFields?.includes(f.field) ?? false,
    ...(f.options ? { options: f.options } : {}),
  }));
}

export function compileGrid(spec: GridSpec, query: GridQuery, base?: SQL): CompiledGrid {
  const search = compileQuickSearch(
    query.q,
    query.qm,
    spec.searchFields.map((f) => exprFor(spec, f)),
  );
  const filters = compileFilters(filterDefsOf(spec), query.filters);
  const parts = [base, search, filters].filter((p): p is SQL => p !== undefined);
  const where =
    parts.length === 0
      ? undefined
      : sql.join(
          parts.map((p) => sql`(${p})`),
          sql` AND `,
        );
  const sortable = Object.fromEntries(spec.sortFields.map((f) => [f, exprFor(spec, f)]));
  const orderBy = compileSort(sortable, query.sort, {
    defaultSort: spec.defaultSort,
    tiebreaker: spec.tiebreaker,
  });
  return {
    where,
    orderBy,
    page: query.page,
    pageSize: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };
}

/** `WHERE …` fragment or empty. */
export const whereClause = (where: SQL | undefined): SQL => (where ? sql`WHERE ${where}` : sql``);

/** IN-list SQL for a scope id list (empty list → never matches). */
export function inList(expr: SQL, ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`0 = 1`;
  return sql`${expr} IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/** Scope fragment for a warehouse + client column pair (client NULL stays visible). */
export function scopeSql(
  warehouse: SQL,
  client: SQL | null,
  scope: { readonly warehouseIds: readonly string[]; readonly clientIds: readonly string[] | 'all' },
): SQL {
  const parts = [inList(warehouse, scope.warehouseIds)];
  if (client && scope.clientIds !== 'all')
    parts.push(sql`(${client} IS NULL OR ${inList(client, scope.clientIds)})`);
  return sql.join(parts, sql` AND `);
}
