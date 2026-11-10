/**
 * Compiles parsed grid filters + a module's `FilterFieldDef[]` (from
 * `src/lib/grid-defs/<module>/**`) into a Drizzle SQL WHERE clause.
 *
 * Only declared fields are filterable (whitelist); an unknown field or an operator that
 * does not fit the field type throws VALIDATION. Values are always bound parameters.
 */
import { and, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { AppError } from "@/server/api/errors";
import { resolveDateRange } from "./date-presets";
import type { GridFilter, QuickSearchMode } from "./grid-query";

export type FilterFieldType = "enum" | "text" | "number" | "date" | "boolean";

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterFieldDef {
  readonly key: string;
  readonly label: string;
  readonly type: FilterFieldType;
  /** Table column, or ... */
  readonly column?: SQLiteColumn;
  /** ... an arbitrary SQL expression (e.g. a correlated subquery). */
  readonly sql?: SQL;
  /** Custom-field slot: compiles to json_extract(<column>, '$.<key>'). */
  readonly customField?: { readonly column: SQLiteColumn; readonly key: string };
  readonly options?: readonly FilterOption[];
  readonly nullable?: boolean;
  /** Date stored as YYYY-MM-DD (compare on the date part only). */
  readonly dateOnly?: boolean;
}

export interface CompileOptions {
  readonly now?: Date;
  readonly tzOffsetMinutes?: number;
}

export const ALLOWED_OPS: Readonly<Record<FilterFieldType, readonly GridFilter["op"][]>> = {
  enum: ["in", "nin", "eq", "ex", "empty"],
  text: ["eq", "ct", "sw", "ew", "in", "nin", "ex", "empty"],
  number: ["eq", "rng", "in", "nin", "ex", "empty"],
  date: ["date", "rng", "ex", "empty"],
  boolean: ["bool", "ex", "empty"],
};

const CUSTOM_FIELD_KEY_RE = /^[A-Za-z0-9_]+$/;

function expressionOf(def: FilterFieldDef): SQL {
  if (def.sql) return def.sql;
  if (def.column) return sql`${def.column}`;
  if (def.customField) {
    if (!CUSTOM_FIELD_KEY_RE.test(def.customField.key)) throw new Error(`Invalid custom field key ${def.customField.key}`);
    return sql`json_extract(${def.customField.column}, ${`$.${def.customField.key}`})`;
  }
  throw new Error(`Filter field "${def.key}" has no column, sql or customField`);
}

/** Escapes LIKE wildcards; pair with `ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const like = (expr: SQL, pattern: string): SQL => sql`${expr} LIKE ${pattern} ESCAPE '\\'`;

function invalid(def: FilterFieldDef, message: string): AppError {
  return new AppError("VALIDATION", `${def.label}: ${message}`, { fieldErrors: { [`f.${def.key}`]: [message] } });
}

function toNumber(def: FilterFieldDef, raw: string): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) throw invalid(def, `"${raw}" is not a number`);
  return n;
}

function coerce(def: FilterFieldDef, raw: string): string | number {
  return def.type === "number" ? toNumber(def, raw) : raw;
}

function dateBound(def: FilterFieldDef, iso: string): string {
  return def.dateOnly ? iso.slice(0, 10) : iso;
}

function rangeSql(expr: SQL, min: string | number | undefined, max: string | number | undefined): SQL {
  const parts: SQL[] = [];
  if (min !== undefined) parts.push(sql`${expr} >= ${min}`);
  if (max !== undefined) parts.push(sql`${expr} <= ${max}`);
  return parts.length === 1 ? (parts[0] as SQL) : (and(...parts) as SQL);
}

function compileOne(def: FilterFieldDef, filter: GridFilter, options: CompileOptions): SQL {
  if (!ALLOWED_OPS[def.type].includes(filter.op)) throw invalid(def, `operator "${filter.op}" is not supported`);
  const expr = expressionOf(def);
  switch (filter.op) {
    case "in":
    case "nin": {
      const values = filter.values.map((v) => coerce(def, v));
      const list = sql.join(values.map((v) => sql`${v}`), sql`, `);
      return filter.op === "in" ? sql`${expr} IN (${list})` : sql`(${expr} IS NULL OR ${expr} NOT IN (${list}))`;
    }
    case "eq":
      return def.type === "number" ? sql`${expr} = ${toNumber(def, filter.value)}` : sql`lower(${expr}) = lower(${filter.value})`;
    case "ct":
      return like(expr, `%${escapeLike(filter.value)}%`);
    case "sw":
      return like(expr, `${escapeLike(filter.value)}%`);
    case "ew":
      return like(expr, `%${escapeLike(filter.value)}`);
    case "ex":
      return sql`(${expr} IS NOT NULL AND ${expr} <> '')`;
    case "empty":
      return sql`(${expr} IS NULL OR ${expr} = '')`;
    case "bool":
      return sql`${expr} = ${filter.value ? 1 : 0}`;
    case "rng": {
      if (def.type === "date") return rangeSql(expr, filter.min, filter.max);
      return rangeSql(expr, filter.min === undefined ? undefined : toNumber(def, filter.min), filter.max === undefined ? undefined : toNumber(def, filter.max));
    }
    case "date": {
      const range = resolveDateRange(filter.date, options.now ?? new Date(), options.tzOffsetMinutes ?? 0);
      return rangeSql(expr, range.from ? dateBound(def, range.from) : undefined, range.to ? dateBound(def, range.to) : undefined);
    }
  }
}

/** ANDs every filter. Returns undefined when there are none. */
export function compileFilters(
  defs: readonly FilterFieldDef[],
  filters: readonly GridFilter[],
  options: CompileOptions = {},
): SQL | undefined {
  if (filters.length === 0) return undefined;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const parts = filters.map((filter) => {
    const def = byKey.get(filter.field);
    if (!def) {
      throw new AppError("VALIDATION", `Unknown filter field "${filter.field}"`, { fieldErrors: { [`f.${filter.field}`]: ["Unknown field"] } });
    }
    return compileOne(def, filter, options);
  });
  return parts.length === 1 ? parts[0] : and(...parts);
}

/**
 * Quick search across `fields` (OR): `eq` = case-insensitive equality, `sw` = starts with.
 * Returns undefined for an empty search.
 */
export function compileQuickSearch(
  q: string | undefined,
  mode: QuickSearchMode,
  fields: readonly (SQLiteColumn | SQL)[],
): SQL | undefined {
  const text = q?.trim();
  if (!text || fields.length === 0) return undefined;
  const parts = fields.map((field) =>
    mode === "eq" ? sql`lower(${field}) = lower(${text})` : like(sql`${field}`, `${escapeLike(text)}%`),
  );
  return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` OR `)})`;
}
