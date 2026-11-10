/**
 * Grid-grammar compiler shared by the M05 lists (purchase orders, receiving history,
 * vendors): whitelisted filters (`f.<field>`), Equal / Starts With quick search and
 * multi-sort, all as bound SQL. Field definitions live in `@/lib/grid-defs/receiving`.
 */
import { asc, desc, sql, type SQL } from "drizzle-orm";
import { AppError } from "@/server/api/errors";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridFilter, GridQuery } from "@/server/query/grid-query";
import type { ReceivingGridField } from "@/lib/grid-defs/receiving/purchase-orders";

export interface GridSpec {
  readonly fields: readonly ReceivingGridField[];
  readonly sortFields: readonly string[];
  readonly searchFields: readonly string[];
  /** SQL expression per field / sort key. */
  readonly exprs: Readonly<Record<string, SQL>>;
  /** Fields compiled by hand (e.g. tags through EXISTS). Return undefined to skip. */
  readonly custom?: Readonly<Record<string, (filter: GridFilter) => SQL | undefined>>;
  /** Default order when the request has no sort. */
  readonly defaultOrder: readonly SQL[];
}

function exprOf(spec: GridSpec, field: string): SQL {
  const expr = spec.exprs[field];
  if (!expr) throw new Error(`grid: no SQL for field "${field}"`);
  return expr;
}

export function filterDefsOf(spec: GridSpec): FilterFieldDef[] {
  return spec.fields
    .filter((f) => !spec.custom?.[f.field])
    .map((f) => ({
      key: f.field,
      label: f.label,
      type: f.type,
      sql: exprOf(spec, f.field),
      nullable: true,
      // Dynamic enums (ids) accept any value; they are bound parameters either way.
      ...(f.options && !f.dynamicOptions ? { options: f.options.map((value) => ({ value, label: value })) } : {}),
    }));
}

const and = (parts: readonly (SQL | undefined)[]): SQL | undefined => {
  const kept = parts.filter((p): p is SQL => p !== undefined);
  if (kept.length === 0) return undefined;
  return kept.length === 1 ? kept[0] : sql`(${sql.join(kept, sql` AND `)})`;
};

export interface CompiledGrid {
  readonly where: SQL | undefined;
  readonly orderBy: readonly SQL[];
}

export function compileGrid(spec: GridSpec, query: GridQuery, extra: readonly (SQL | undefined)[] = []): CompiledGrid {
  const sortable = new Set(spec.sortFields);
  const badSort = query.sort.find((s) => !sortable.has(s.field));
  if (badSort) throw new AppError("VALIDATION", `Cannot sort by "${badSort.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  const known = new Set(spec.fields.map((f) => f.field));
  const unknown = query.filters.find((f) => !known.has(f.field));
  if (unknown) throw new AppError("VALIDATION", `Unknown filter "${unknown.field}"`, { fieldErrors: { [`f.${unknown.field}`]: ["Unknown filter field"] } });

  const customParts = query.filters.filter((f) => spec.custom?.[f.field]).map((f) => spec.custom?.[f.field]?.(f));
  const plain = query.filters.filter((f) => !spec.custom?.[f.field]);
  const search = compileQuickSearch(query.q, query.qm, spec.searchFields.map((f) => exprOf(spec, f)));
  const filters = compileFilters(filterDefsOf(spec), plain);
  const where = and([search, filters, ...customParts, ...extra]);
  const orderBy = query.sort.length > 0
    ? query.sort.map((s) => (s.dir === "asc" ? asc(exprOf(spec, s.field)) : desc(exprOf(spec, s.field))))
    : [...spec.defaultOrder];
  return { where, orderBy };
}

/** Tag filter over `entity_tags` (in / nin / empty / ex). */
export function tagFilter(entityType: string, idColumn: SQL): (filter: GridFilter) => SQL | undefined {
  return (filter) => {
    const has = (ids?: readonly string[]) =>
      ids && ids.length > 0
        ? sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = ${entityType} AND et.entity_id = ${idColumn} AND et.tag_id IN (${sql.join(ids.map((v) => sql`${v}`), sql`, `)}))`
        : sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = ${entityType} AND et.entity_id = ${idColumn})`;
    switch (filter.op) {
      case "in":
        return has(filter.values);
      case "nin":
        return sql`NOT ${has(filter.values)}`;
      case "empty":
        return sql`NOT ${has()}`;
      case "ex":
        return has();
      default:
        throw new AppError("VALIDATION", "Tag: unsupported operator", { fieldErrors: { "f.tag": ["Unsupported operator"] } });
    }
  };
}
