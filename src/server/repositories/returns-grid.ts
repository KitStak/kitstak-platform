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
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { dbAll, dbGet } from "@/server/db/sql";

const raw = (expr: string): SQL => sql.raw(expr);

const TAG_NAMES = "(SELECT string_agg((t.name)::text, ', ') FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = 'return_order' AND et.entity_id = ro.id)";
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
  labelShipmentId: "ro.return_label_shipment_id",
  labelFileId: "(SELECT s.label_file_id FROM shipments s WHERE s.id = ro.return_label_shipment_id)",
  labelStatus: "(SELECT s.label_status FROM shipments s WHERE s.id = ro.return_label_shipment_id)",
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
  readonly labelShipmentId: string | null;
  readonly labelFileId: string | null;
  readonly labelStatus: string | null;
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

/**
 * An RMA can carry several tracking numbers ("1ZRET0001, 1ZRET0002" in `tracking_number`), so
 * exact matches compare against each number, not the whole stored value.
 */
const TRACKING_TOKENS = "(',' || replace(lower(coalesce(ro.tracking_number, '')), ' ', '') || ',')";
export function trackingTokenSql(values: readonly string[], mode: "exact" | "prefix" = "exact"): SQL {
  const clean = values.map((v) => v.trim().toLowerCase().replace(/\s+/g, "")).filter(Boolean);
  if (clean.length === 0) return sql`false`;
  const parts = clean.map((v) => sql`strpos(${raw(TRACKING_TOKENS)}, ${mode === "exact" ? `,${v},` : `,${v}`}) > 0`);
  return parts.length === 1 ? (parts[0] as SQL) : sql`(${sql.join(parts, sql` OR `)})`;
}

function trackingFilterSql(f: GridQuery["filters"][number]): SQL | undefined {
  if (f.field !== "trackingNumber") return undefined;
  if (f.op === "eq") return trackingTokenSql([f.value]);
  if (f.op === "in") return trackingTokenSql(f.values);
  if (f.op === "nin") return sql`NOT ${trackingTokenSql(f.values)}`;
  return undefined;
}

export function compileReturnWhere(query: GridQuery, scope: Scope, extra: readonly (SQL | undefined)[] = []): SQL {
  const baseSearch = compileQuickSearch(query.q, query.qm, RETURN_SEARCH_FIELDS.map(exprFor));
  const q = query.q?.trim();
  const search = baseSearch && q && (RETURN_SEARCH_FIELDS as readonly string[]).includes("trackingNumber")
    ? sql`(${baseSearch} OR ${trackingTokenSql([q], query.qm === "eq" ? "exact" : "prefix")})`
    : baseSearch;
  const tracking = query.filters.map(trackingFilterSql);
  const rest = query.filters.filter((_, i) => tracking[i] === undefined);
  const generic = compileFilters(RETURN_FILTER_DEFS, rest);
  const trackingParts = tracking.filter((p): p is SQL => p !== undefined);
  const filters = trackingParts.length ? sql.join([...(generic ? [generic] : []), ...trackingParts].map((p) => sql`(${p})`), sql` AND `) : generic;
  const parts = [returnScopeSql(scope), search, filters, ...extra].filter((p): p is SQL => p !== undefined);
  return sql.join(parts.map((p) => sql`(${p})`), sql` AND `);
}

export function compileReturnOrder(query: GridQuery): SQL {
  const sortable = new Set<string>(RETURN_SORT_FIELDS);
  const bad = query.sort.find((s) => !sortable.has(s.field));
  if (bad) throw new AppError("VALIDATION", `Cannot sort by "${bad.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  const specs = query.sort.length > 0 ? query.sort : [{ field: "createdAt", dir: "desc" as const }];
  // SQLite NULL placement (first ascending, last descending); Postgres defaults to the opposite.
  const parts = specs.map((s) => sql`${exprFor(s.field)} ${raw(s.dir === "asc" ? "ASC NULLS FIRST" : "DESC NULLS LAST")}`);
  return sql.join([...parts, sql`rl.id ASC`], sql`, `);
}

export interface ReturnListResult {
  readonly rows: readonly ReturnGridRow[];
  readonly total: number;
}

export async function listReturnLines(db: AppDb, scope: Scope, query: GridQuery, extra: readonly (SQL | undefined)[] = []): Promise<ReturnListResult> {
  const where = compileReturnWhere(query, scope, extra);
  const offset = (Math.max(1, query.page) - 1) * query.pageSize;
  const rows = await dbAll<ReturnGridRow>(db, sql`SELECT ${raw(SELECT_LIST)} ${raw(FROM)} WHERE ${where} ORDER BY ${compileReturnOrder(query)} LIMIT ${query.pageSize} OFFSET ${offset}`);
  const total = (await dbGet<{ n: number }>(db, sql`SELECT COUNT(*) AS n ${raw(FROM)} WHERE ${where}`))?.n ?? 0;
  return { rows, total };
}

/**
 * Grid rows (RMA lines) per RMA status, for the status pills. Uses the grid's own FROM and
 * WHERE (search + every filter except status), so "All lines" always equals the unfiltered
 * grid Total and each pill equals the Total after picking it.
 */
export async function returnStatusCounts(db: AppDb, scope: Scope, query: GridQuery = EMPTY_GRID_QUERY): Promise<Readonly<Record<string, number>>> {
  const where = compileReturnWhere({ ...query, filters: query.filters.filter((f) => f.field !== "status") }, scope);
  const rows = await dbAll<{ status: string; n: number }>(db, sql`SELECT ro.status AS status, COUNT(*) AS n ${raw(FROM)} WHERE ${where} GROUP BY ro.status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
