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
import type { GridFilter, GridQuery, SortSpec } from "@/server/query/grid-query";
import { resolveDateRange } from "@/server/query/date-presets";
import { sortableOf, type ReportDef } from "@/lib/grid-defs/reports/types";
import { dbAll, dbGet } from "@/server/db/sql";

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

/**
 * Grid query plus the warehouse zone offset (minutes east of UTC) used for date chips such
 * as "Today" / "Within 7 Day(s) Past" (RA-R3-1), so a report and an analytics drilldown
 * agree on where a day starts. Set by the report route from the viewer's warehouse.
 */
export type ReportQuery = GridQuery & { readonly tzOffsetMinutes?: number };

/** Offset (minutes east of UTC) of an IANA zone at an instant; invalid zones → 0 (UTC). */
export function zoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

/** Zone offset of the viewer's first warehouse in scope (the header context). */
export async function reportZoneOffset(db: AppDb, warehouseIds: readonly string[], at: Date = new Date()): Promise<number> {
  const id = warehouseIds[0];
  if (!id) return 0;
  const tz = (await dbGet<{ tz: string | null }>(db, sql`SELECT timezone AS tz FROM warehouses WHERE id = ${id}`))?.tz;
  return tz ? zoneOffsetMinutes(tz, at) : 0;
}

export interface CompiledReportGrid {
  readonly where: SQL;
  readonly orderBy: SQL;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Date chips on DATE-ONLY report columns (values are local calendar days, e.g. User Performance
 * "Activity Date") resolve in the warehouse zone and compare as local days. The shared compiler
 * slices the UTC instant of the local bound, which for zones west of UTC turns the inclusive
 * end of "..2026-11-10" into "2026-11-11" (one extra day). Converting the resolved bounds to
 * local dates first and filtering with an inclusive day range keeps a drilldown's rows exactly
 * the days it names.
 */
export function localizeDateOnlyFilters(def: ReportDef, filters: readonly GridFilter[], tzOffsetMinutes: number, now: Date = new Date()): GridFilter[] {
  const dateOnly = new Set(def.fields.filter((f) => f.dateOnly).map((f) => f.field));
  const localDay = (iso: string): string => new Date(Date.parse(iso) + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
  return filters.map((f) => {
    if (f.op !== "date" || !dateOnly.has(f.field)) return f;
    const range = resolveDateRange(f.date, now, tzOffsetMinutes);
    return { field: f.field, op: "rng", ...(range.from ? { min: localDay(range.from) } : {}), ...(range.to ? { max: localDay(range.to) } : {}) };
  });
}

/** Compiles a parsed grid query against a def; unknown sort / filter fields → VALIDATION. */
export function compileReportGrid(def: ReportDef, query: ReportQuery, skipFilters: readonly string[] = []): CompiledReportGrid {
  const sortable = new Set(sortableOf(def));
  const bad = query.sort.find((s) => !sortable.has(s.field));
  if (bad) throw new AppError("VALIDATION", `Cannot sort by "${bad.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  const search = compileQuickSearch(query.q, query.qm, def.search.map(col));
  const tz = query.tzOffsetMinutes ?? 0;
  const filters = compileFilters(reportFilterDefs(def), localizeDateOnlyFilters(def, query.filters.filter((f) => !skipFilters.includes(f.field)), tz), { tzOffsetMinutes: tz });
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
export async function runReport<T>(db: AppDb, inner: SQL, def: ReportDef, query: ReportQuery, skipFilters: readonly string[] = []): Promise<ReportPage<T>> {
  const c = compileReportGrid(def, query, skipFilters);
  const rows = await dbAll<T>(db, sql`SELECT * FROM (${inner}) t WHERE ${c.where} ORDER BY ${c.orderBy}, ${col(def.rowKey)} LIMIT ${c.limit} OFFSET ${c.offset}`);
  const count = await dbGet<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM (${inner}) t WHERE ${c.where}`);
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
  return sql.raw(`CASE WHEN ${alias}.name ILIKE ${alias}.code || '%' THEN ${alias}.name ELSE ${alias}.code || ' - ' || ${alias}.name END`);
}
