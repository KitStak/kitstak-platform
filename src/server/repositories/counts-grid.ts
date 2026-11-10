/**
 * Raw-SQL grid runner for the count grids (M07). Each grid declares its FROM clause and a
 * map of field → SQL expression; filters (`f.<field>`), quick search (`q`/`qm`), multi
 * sort and paging come from the shared grid grammar. Unknown sort / filter fields → 400.
 */
import { sql, type SQL } from "drizzle-orm";
import { AppError } from "@/server/api/errors";
import type { AppDb } from "@/server/api/db";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery } from "@/server/query/grid-query";
import type { CountGridField } from "@/lib/grid-defs/counts/count-grids";

export interface GridSpec {
  /** `FROM … JOIN …` (raw, no user input). */
  readonly from: SQL;
  /** Field → SQL expression (also the SELECT list, aliased by field name). */
  readonly columns: Readonly<Record<string, SQL>>;
  readonly fields: readonly CountGridField[];
  readonly sortable: readonly string[];
  readonly search: readonly string[];
  /** Always-on conditions (scope, tab). */
  readonly base: readonly SQL[];
  /** Tie-breaker / default order. */
  readonly defaultOrder: SQL;
}

export const raw = (s: string): SQL => sql.raw(s);

function exprOf(spec: GridSpec, field: string): SQL {
  const e = spec.columns[field];
  if (!e) throw new AppError("VALIDATION", `Unknown field "${field}"`, { fieldErrors: { sort: ["Unknown field"] } });
  return e;
}

export function filterDefs(spec: GridSpec): FilterFieldDef[] {
  return spec.fields.map((f) => ({
    key: f.field, label: f.label, type: f.type, sql: exprOf(spec, f.field), nullable: true,
    ...(f.options ? { options: f.options.map((value) => ({ value, label: value })) } : {}),
  }));
}

export function whereOf(spec: GridSpec, query: GridQuery): SQL {
  const parts: SQL[] = [...spec.base];
  const search = compileQuickSearch(query.q, query.qm, spec.search.map((f) => exprOf(spec, f)));
  if (search) parts.push(search);
  const filters = compileFilters(filterDefs(spec), query.filters);
  if (filters) parts.push(filters);
  return parts.length === 0 ? sql`1 = 1` : sql.join(parts.map((p) => sql`(${p})`), sql` AND `);
}

export function orderOf(spec: GridSpec, query: GridQuery): SQL {
  const allowed = new Set(spec.sortable);
  const parts = query.sort.map((s) => {
    if (!allowed.has(s.field)) throw new AppError("VALIDATION", `Cannot sort by "${s.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
    return sql`${exprOf(spec, s.field)} ${raw(s.dir === "asc" ? "ASC" : "DESC")}`;
  });
  return sql.join([...parts, spec.defaultOrder], sql`, `);
}

function selectList(spec: GridSpec): SQL {
  return sql.join(Object.entries(spec.columns).map(([k, e]) => sql`${e} AS ${raw(`"${k}"`)}`), sql`, `);
}

export interface GridPage<T> {
  readonly rows: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function runGrid<T>(db: AppDb, spec: GridSpec, query: GridQuery): GridPage<T> {
  const where = whereOf(spec, query);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n ${spec.from} WHERE ${where}`)?.n ?? 0;
  const offset = (Math.max(1, query.page) - 1) * query.pageSize;
  const rows = db.all<T>(sql`SELECT ${selectList(spec)} ${spec.from} WHERE ${where} ORDER BY ${orderOf(spec, query)} LIMIT ${query.pageSize} OFFSET ${offset}`);
  return { rows, total, page: query.page, pageSize: query.pageSize };
}

/** Rows by id (bulk confirms, exports), same projection as the grid. */
export function gridRowsById<T>(db: AppDb, spec: GridSpec, idExpr: SQL, ids: readonly string[]): T[] {
  if (ids.length === 0) return [];
  const where = sql.join([...spec.base, sql`${idExpr} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`].map((p) => sql`(${p})`), sql` AND `);
  return db.all<T>(sql`SELECT ${selectList(spec)} ${spec.from} WHERE ${where} ORDER BY ${spec.defaultOrder}`);
}

/** `col IN (…)` for a scope id list (empty list → never true). */
export function inList(expr: SQL, ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`0 = 1`;
  return sql`${expr} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

/** Converts SQLite 0/1 to booleans for the listed keys. */
export function withBooleans<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) out[k] = row[k] === 1 || row[k] === true;
  return out as T;
}
