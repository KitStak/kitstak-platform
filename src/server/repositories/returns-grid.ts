/**
 * Return Orders grid (M04 §6): one row per RMA line, the Logiwa 25 columns + extras,
 * grid grammar (`q`/`qm`, `f.<field>`, `sort`, `page`/`ps`) and scope filtering.
 * Field keys come from `@/lib/grid-defs/returns/return-orders`.
 */
import { sql, type SQL } from "drizzle-orm";
import { RETURN_GRID_FIELDS, RETURN_SEARCH_FIELDS, RETURN_SORT_FIELDS } from "@/lib/grid-defs/returns/return-orders";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { Scope } from "@/server/auth/scope";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery } from "@/server/query/grid-query";

const raw = (expr: string): SQL => sql.raw(expr);

const TAG_NAMES = "(SELECT group_concat(t.name, ', ') FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = 'return_order' AND et.entity_id = ro.id)";
const RETURN_ADDRESS = `COALESCE(
  (SELECT a.line1 || ', ' || a.city || COALESCE(', ' || a.state, '') || ' ' || a.postal_code FROM addresses a WHERE a.id = ro.return_address_id),
  w.address_line || ', ' || w.city || COALESCE(', ' || w.state, '') || COALESCE(' ' || w.postal_code, ''))`;

/** SQL expression per grid field / column. */
export const RETURN_COLUMN_SQL: Readonly<Record<string, string>> = {
  id: "rl.id",
  returnOrderId: "ro.id",
  rmaCode: "ro.rma_code",
  status: "ro.status",
  lineStatus: "rl.line_status",
  source: "ro.source",
  shipmentOrderId: "ro.shipment_order_id",
  shipmentOrderCode: "so.code",
  storeOrderNumber: "so.store_order_number",
  store: "so.channel",
  companyName: "so.company_name",
  returnAddress: RETURN_ADDRESS,
  fromCountry: "ro.from_country",
  requestedQty: "rl.requested_qty",
  returnedQty: "rl.returned_qty",
  sku: "p.sku",
  productName: "p.name",
  productId: "rl.product_id",
  customerName: "COALESCE(ro.customer_name, so.customer_name)",
  carrierName: "ro.carrier_code",
  carrierServiceName: "ro.carrier_service_name",
  trackingNumber: "ro.tracking_number",
  packType: "rl.pack_type",
  createdAt: "ro.created_at",
  shipmentOrderDate: "so.order_date",
  deliveryDate: "so.delivered_at",
  expectedReturnDate: "ro.expected_return_date",
  actualReturnDate: "ro.actual_return_date",
  createdByName: "COALESCE(u.name, 'System')",
  warehouseId: "ro.warehouse_id",
  warehouseCode: "w.code",
  clientId: "ro.client_id",
  clientName: "c.name",
  tagNames: TAG_NAMES,
  tagName: TAG_NAMES,
  disposition: "rl.disposition",
  customerReturnReason: "(SELECT lv.name FROM lookup_values lv WHERE lv.id = rl.customer_return_reason_id)",
  actualReturnReason: "(SELECT lv.name FROM lookup_values lv WHERE lv.id = rl.actual_return_reason_id)",
  version: "ro.version",
};

const FROM = `FROM return_order_lines rl
  JOIN return_orders ro ON ro.id = rl.return_order_id
  JOIN products p ON p.id = rl.product_id
  JOIN warehouses w ON w.id = ro.warehouse_id
  JOIN clients c ON c.id = ro.client_id
  LEFT JOIN shipment_orders so ON so.id = ro.shipment_order_id
  LEFT JOIN users u ON u.id = ro.created_by`;

const SELECT_LIST = Object.entries(RETURN_COLUMN_SQL).filter(([k]) => k !== "tagName").map(([k, e]) => `${e} AS "${k}"`).join(",\n  ");

function exprFor(field: string): SQL {
  const e = RETURN_COLUMN_SQL[field];
  if (!e) throw new AppError("VALIDATION", `Unknown field "${field}"`);
  return raw(e);
}

const DATE_ONLY = new Set(["expectedReturnDate"]);

export const RETURN_FILTER_DEFS: readonly FilterFieldDef[] = RETURN_GRID_FIELDS.map((f) => ({
  key: f.field, label: f.label, type: f.type, sql: exprFor(f.field), nullable: true, dateOnly: DATE_ONLY.has(f.field),
  ...(f.options ? { options: f.options.map((value) => ({ value, label: value })) } : {}),
}));

export interface ReturnGridRow {
  readonly id: string;
  readonly returnOrderId: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly lineStatus: string;
  readonly source: string;
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly storeOrderNumber: string | null;
  readonly store: string | null;
  readonly companyName: string | null;
  readonly returnAddress: string | null;
  readonly fromCountry: string | null;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly sku: string;
  readonly productName: string;
  readonly productId: string;
  readonly customerName: string | null;
  readonly carrierName: string | null;
  readonly carrierServiceName: string | null;
  readonly trackingNumber: string | null;
  readonly packType: string;
  readonly createdAt: string;
  readonly shipmentOrderDate: string | null;
  readonly deliveryDate: string | null;
  readonly expectedReturnDate: string | null;
  readonly actualReturnDate: string | null;
  readonly createdByName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly tagNames: string | null;
  readonly disposition: string | null;
  readonly customerReturnReason: string | null;
  readonly actualReturnReason: string | null;
  readonly version: number;
}

function inList(column: string, ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`0 = 1`;
  return sql`${raw(column)} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

/** Scope fragment over `ro` (warehouse + client). */
export function returnScopeSql(scope: Scope): SQL {
  const parts = [inList("ro.warehouse_id", scope.warehouseIds)];
  if (scope.clientIds !== "all") parts.push(inList("ro.client_id", scope.clientIds));
  return sql.join(parts, sql` AND `);
}

export function compileReturnWhere(query: GridQuery, scope: Scope, extra: readonly (SQL | undefined)[] = []): SQL {
  const search = compileQuickSearch(query.q, query.qm, RETURN_SEARCH_FIELDS.map(exprFor));
  const filters = compileFilters(RETURN_FILTER_DEFS, query.filters);
  const parts = [returnScopeSql(scope), search, filters, ...extra].filter((p): p is SQL => p !== undefined);
  return sql.join(parts.map((p) => sql`(${p})`), sql` AND `);
}

export function compileReturnOrder(query: GridQuery): SQL {
  const sortable = new Set<string>(RETURN_SORT_FIELDS);
  const bad = query.sort.find((s) => !sortable.has(s.field));
  if (bad) throw new AppError("VALIDATION", `Cannot sort by "${bad.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  const specs = query.sort.length > 0 ? query.sort : [{ field: "createdAt", dir: "desc" as const }];
  const parts = specs.map((s) => sql`${exprFor(s.field)} ${raw(s.dir === "asc" ? "ASC" : "DESC")}`);
  return sql.join([...parts, sql`rl.id ASC`], sql`, `);
}

export interface ReturnListResult {
  readonly rows: readonly ReturnGridRow[];
  readonly total: number;
}

export function listReturnLines(db: AppDb, scope: Scope, query: GridQuery, extra: readonly (SQL | undefined)[] = []): ReturnListResult {
  const where = compileReturnWhere(query, scope, extra);
  const offset = (Math.max(1, query.page) - 1) * query.pageSize;
  const rows = db.all<ReturnGridRow>(sql`SELECT ${raw(SELECT_LIST)} ${raw(FROM)} WHERE ${where} ORDER BY ${compileReturnOrder(query)} LIMIT ${query.pageSize} OFFSET ${offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n ${raw(FROM)} WHERE ${where}`)?.n ?? 0;
  return { rows, total };
}

/** Count of RMAs (not lines) per status in scope, for the status pills. */
export function returnStatusCounts(db: AppDb, scope: Scope): Readonly<Record<string, number>> {
  const rows = db.all<{ status: string; n: number }>(sql`SELECT ro.status AS status, COUNT(*) AS n FROM return_orders ro WHERE ${returnScopeSql(scope)} GROUP BY ro.status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
