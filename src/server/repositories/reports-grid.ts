/**
 * Grid-grammar compiler for the M13 report grids (BUILD_PLAN 0.2). Every report is an
 * inner SELECT whose column aliases equal the def's field/column ids; this wraps it as
 * `SELECT * FROM (<inner>) t WHERE … ORDER BY … LIMIT …`. Aliases come only from the
 * static grid defs, never from the request, so the raw identifiers are safe.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery, SortSpec } from "@/server/query/grid-query";
import { sortableOf, type ReportDef } from "@/lib/grid-defs/reports/types";

const ALIAS_RE = /^[A-Za-z][A-Za-z0-9]*$/;

export function col(alias: string): SQL {
  if (!ALIAS_RE.test(alias)) throw new Error(`reports-grid: bad alias "${alias}"`);
  return sql.raw(`t."${alias}"`);
}

export function reportFilterDefs(def: ReportDef): FilterFieldDef[] {
  return def.fields.map((f) => ({
    key: f.field,
    label: f.label,
    type: f.type,
    sql: col(f.filterAlias ?? f.field),
    nullable: true,
    ...(f.dateOnly ? { dateOnly: true } : {}),
  }));
}

function parseSortToken(token: string): SortSpec {
  return token.startsWith("-") ? { field: token.slice(1), dir: "desc" } : { field: token, dir: "asc" };
}

export interface CompiledReportGrid {
  readonly where: SQL;
  readonly orderBy: SQL;
  readonly limit: number;
  readonly offset: number;
}

/** Compiles a parsed grid query against a def; unknown sort / filter fields → VALIDATION. */
export function compileReportGrid(def: ReportDef, query: GridQuery, skipFilters: readonly string[] = []): CompiledReportGrid {
  const sortable = new Set(sortableOf(def));
  const bad = query.sort.find((s) => !sortable.has(s.field));
  if (bad) throw new AppError("VALIDATION", `Cannot sort by "${bad.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  const search = compileQuickSearch(query.q, query.qm, def.search.map(col));
  const filters = compileFilters(reportFilterDefs(def), query.filters.filter((f) => !skipFilters.includes(f.field)));
  const parts = [search, filters].filter((p): p is SQL => p !== undefined);
  const where = parts.length === 0 ? sql`1 = 1` : sql.join(parts, sql` AND `);
  const sorts = query.sort.length > 0 ? query.sort : def.defaultSort.map(parseSortToken);
  const orderBy = sql.join(
    sorts.map((s) => sql`${col(s.field)} IS NULL, ${col(s.field)} ${sql.raw(s.dir === "asc" ? "ASC" : "DESC")}`),
    sql`, `,
  );
  const pageSize = Math.max(1, query.pageSize);
  return { where, orderBy, limit: pageSize, offset: (Math.max(1, query.page) - 1) * pageSize };
}

export interface ReportPage<T> {
  readonly rows: T[];
  readonly total: number;
}

/** Runs `inner` with the compiled grid; `def.rowKey` keeps paging stable. */
export function runReport<T>(db: AppDb, inner: SQL, def: ReportDef, query: GridQuery, skipFilters: readonly string[] = []): ReportPage<T> {
  const c = compileReportGrid(def, query, skipFilters);
  const rows = db.all<T>(sql`SELECT * FROM (${inner}) t WHERE ${c.where} ORDER BY ${c.orderBy}, ${col(def.rowKey)} LIMIT ${c.limit} OFFSET ${c.offset}`);
  const count = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM (${inner}) t WHERE ${c.where}`);
  return { rows, total: Number(count?.n ?? 0) };
}

/** `IN (…)` list, or a FALSE predicate for an empty list. */
export function inList(expr: SQL, values: readonly string[]): SQL {
  if (values.length === 0) return sql`0 = 1`;
  return sql`${expr} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/** Client restriction for a scope (`"all"` → no restriction). */
export function clientIn(expr: SQL, clientIds: readonly string[] | "all"): SQL {
  return clientIds === "all" ? sql`1 = 1` : inList(expr, clientIds);
}

/** `CODE - Name` warehouse label (never duplicates the code). */
export function warehouseLabel(alias: string): SQL {
  return sql.raw(`CASE WHEN ${alias}.name LIKE ${alias}.code || '%' THEN ${alias}.name ELSE ${alias}.code || ' - ' || ${alias}.name END`);
}
