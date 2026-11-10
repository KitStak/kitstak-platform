/**
 * Grid-grammar compilation for `GET /api/work-orders` (BUILD_PLAN 0.2): quick search,
 * `f.<field>` filters (whitelisted by `@/lib/grid-defs/work-orders`), multi-sort.
 */
import { asc, desc, sql, type SQL } from "drizzle-orm";
import { AppError } from "@/server/api/errors";
import * as schema from "@/server/db/schema";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery } from "@/server/query/grid-query";
import { WORK_ORDER_GRID_FIELDS, WORK_ORDER_SEARCH_FIELDS, WORK_ORDER_SORT_FIELDS } from "@/lib/grid-defs/work-orders/work-orders";

const wo = schema.workOrders;

const TAG_NAMES_SQL: SQL = sql`(SELECT group_concat(t.name, ', ') FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = 'work_order' AND et.entity_id = ${wo.id})`;

/** Correlated expressions so they work in the list and the count query alike. */
export const WO_EXPR: Readonly<Record<string, SQL>> = {
  code: sql`${wo.code}`,
  warehouseCode: sql`(SELECT w.code FROM warehouses w WHERE w.id = ${wo.warehouseId})`,
  clientName: sql`(SELECT c.name FROM clients c WHERE c.id = ${wo.clientId})`,
  status: sql`${wo.status}`,
  age: sql`CAST(julianday('now') - julianday(${wo.createdAt}) AS INTEGER)`,
  operationType: sql`${wo.operationType}`,
  type: sql`${wo.type}`,
  jobCode: sql`(SELECT j.code FROM jobs j WHERE j.id = ${wo.jobId})`,
  kitSku: sql`(SELECT p.sku FROM products p WHERE p.id = ${wo.kitProductId})`,
  processedSku: sql`((SELECT p.sku FROM products p WHERE p.id = ${wo.kitProductId}) || ',' || COALESCE((SELECT group_concat(p.sku, ',') FROM work_order_components c JOIN products p ON p.id = c.component_product_id WHERE c.work_order_id = ${wo.id}), ''))`,
  requestedQty: sql`${wo.requestedQty}`,
  processedQty: sql`${wo.processedQty}`,
  extraNote: sql`${wo.extraNote}`,
  kittingInstructions: sql`${wo.kittingInstructions}`,
  tags: TAG_NAMES_SQL,
  createdAt: sql`${wo.createdAt}`,
  plannedStartAt: sql`${wo.plannedStartAt}`,
  plannedFinishAt: sql`${wo.plannedFinishAt}`,
  actualStartAt: sql`${wo.actualStartAt}`,
  actualFinishAt: sql`${wo.actualFinishAt}`,
  cancelledAt: sql`${wo.cancelledAt}`,
};

export { TAG_NAMES_SQL };

function exprFor(field: string): SQL {
  const expr = WO_EXPR[field];
  if (!expr) throw new Error(`work-orders-grid: no SQL for field "${field}"`);
  return expr;
}

export const WO_FILTER_DEFS: readonly FilterFieldDef[] = WORK_ORDER_GRID_FIELDS.map((f) => ({
  key: f.field,
  label: f.label,
  type: f.type,
  nullable: true,
  ...(f.slot ? { customField: { column: wo.customFields, key: f.slot } } : { sql: exprFor(f.field) }),
}));

/** Whitelists filter and sort fields of a locally evaluated grid. */
export function assertGridFields(query: GridQuery, filterFields: readonly string[], sortFields: readonly string[]): void {
  const filters = new Set(filterFields);
  const unknownFilter = query.filters.find((f) => !filters.has(f.field));
  if (unknownFilter) throw new AppError("VALIDATION", `Unknown filter field "${unknownFilter.field}"`, { fieldErrors: { [`f.${unknownFilter.field}`]: ["Unknown field"] } });
  const sorts = new Set(sortFields);
  const unknownSort = query.sort.find((s) => !sorts.has(s.field));
  if (unknownSort) throw new AppError("VALIDATION", `Cannot sort by "${unknownSort.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
}

export interface CompiledWoQuery {
  readonly where: SQL | undefined;
  readonly orderBy: readonly SQL[];
}

export function compileWorkOrderQuery(query: GridQuery): CompiledWoQuery {
  assertGridFields(query, WORK_ORDER_GRID_FIELDS.map((f) => f.field), WORK_ORDER_SORT_FIELDS);
  const search = compileQuickSearch(query.q, query.qm, WORK_ORDER_SEARCH_FIELDS.map(exprFor));
  const filters = compileFilters(WO_FILTER_DEFS, query.filters);
  const parts = [search, filters].filter((p): p is SQL => p !== undefined);
  const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` AND `)})`;
  const sort = query.sort.length ? query.sort : [{ field: "createdAt", dir: "desc" as const }];
  const orderBy = [...sort.map((s) => (s.dir === "asc" ? asc(exprFor(s.field)) : desc(exprFor(s.field)))), desc(wo.code)];
  return { where, orderBy };
}
