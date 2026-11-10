/**
 * Grid-grammar compiler for the Shipment Orders grids (BUILD_PLAN 0.2): every column id
 * and filter field from `@/lib/grid-defs/orders/shipment-orders` maps to one SQL
 * expression over `shipment_orders` (correlated subqueries, so the same expressions work
 * in the page query and the bare count query).
 */
import { asc, desc, getTableColumns, sql, type SQL } from "drizzle-orm";
import { schema } from "@/server/db";
import { AppError } from "@/server/api/errors";
import { compileFilters, compileQuickSearch, type FilterFieldDef } from "@/server/query/filters";
import { parseGridQuery, type GridQuery } from "@/server/query/grid-query";
import { ORDER_FILTER_FIELDS, ORDER_SEARCH_FIELDS, ORDER_SORT_FIELDS } from "@/lib/grid-defs/orders/shipment-orders";
import { effectiveRankSql } from "@/lib/grid-defs/orders/priority";

const so = schema.shipmentOrders;

/**
 * Table-qualified column references. Drizzle renders `${so.id}` as a bare `"id"` in a
 * single-table select, which a correlated subquery then binds to ITS OWN `id` (or reports
 * as ambiguous). Every expression here therefore uses `q.<column>` = `"shipment_orders"."<col>"`.
 */
export const q = Object.fromEntries(
  Object.entries(getTableColumns(so)).map(([key, col]) => [key, sql.raw(`"shipment_orders"."${col.name}"`)]),
) as { readonly [K in keyof typeof so.$inferSelect]: SQL };

const days = (from: SQL): SQL => sql`CAST(julianday(COALESCE(${q.shippedAt}, ${q.cancelledAt}, 'now')) - julianday(${from}) AS INTEGER)`;
/** The single integer priority (column, sort, numeric filter, export); see grid-defs/orders/priority. */
const priorityRank = sql.raw(effectiveRankSql(`"shipment_orders"."priority"`, `"shipment_orders"."priority_rank"`));
const cf = (key: string): SQL => sql`json_extract(${q.customFields}, ${`$.${key}`})`;

/** SQL per column id / filter field. */
export const ORDER_SQL: Readonly<Record<string, SQL>> = {
  code: sql`${q.code}`,
  storeOrderNumber: sql`${q.storeOrderNumber}`,
  // Company: the order's own company, else the customer's default address company, else the retailer (B2B).
  companyName: sql`COALESCE(NULLIF(${q.companyName}, ''), (SELECT a.company_name FROM addresses a WHERE a.owner_type = 'customer' AND a.owner_id = ${q.customerId} AND a.company_name IS NOT NULL AND a.company_name <> '' ORDER BY a.is_default DESC LIMIT 1), (SELECT r.name FROM retailers r WHERE r.id = ${q.retailerId}))`,
  channelPaymentStatus: sql`${q.channelPaymentStatus}`,
  storeName: sql`COALESCE(${q.storeName}, CASE WHEN ${q.channel} = 'Manual' THEN 'Created Manually' END)`,
  channel: sql`${q.channel}`,
  age: days(sql`${q.orderDate}`),
  processingAge: days(sql`${q.createdAt}`),
  daysSinceShipped: sql`CASE WHEN COALESCE(${q.shippedAt}, ${q.cancelledAt}) IS NULL THEN NULL ELSE CAST(julianday('now') - julianday(COALESCE(${q.shippedAt}, ${q.cancelledAt})) AS INTEGER) END`,
  totalWeightOz: sql`${q.totalWeightOz}`,
  clientId: sql`${q.clientId}`,
  clientName: sql`(SELECT c.name FROM clients c WHERE c.id = ${q.clientId})`,
  warehouseId: sql`${q.warehouseId}`,
  // Same label as the detail page (`codeNameLabel`): "MLT1 - Main Fulfillment"; the code is not repeated when the name starts with it.
  warehouseCode: sql`(SELECT CASE WHEN w.code IS NULL OR w.code = '' THEN w.name WHEN upper(w.name) = upper(w.code) OR upper(w.name) LIKE upper(w.code) || ' %' THEN w.name ELSE w.code || ' - ' || w.name END FROM warehouses w WHERE w.id = ${q.warehouseId})`,
  status: sql`${q.status}`,
  pickShortStatus: sql`${q.pickShortStatus}`,
  packShortStatus: sql`${q.packShortStatus}`,
  totalQuantity: sql`${q.totalQuantity}`,
  skus: sql`(SELECT group_concat(p.sku, ' / ') FROM order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ${q.id})`,
  sku: sql`(SELECT group_concat(p.sku, ' / ') FROM order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ${q.id})`,
  kitSku: sql`(SELECT group_concat(p.sku, ' / ') FROM order_lines l JOIN products p ON p.id = l.kit_product_id WHERE l.order_id = ${q.id})`,
  jobCode: sql`(SELECT j.code FROM jobs j WHERE j.id = ${q.jobId})`,
  customerName: sql`${q.customerName}`,
  requestedShippingOption: sql`${q.requestedShippingOption}`,
  carrier: sql`${q.carrier}`,
  carrierSetupName: sql`(SELECT cc.setup_name FROM carrier_connections cc WHERE cc.id = ${q.carrierConnectionId})`,
  shippingService: sql`${q.shippingService}`,
  isAutoShip: sql`${q.isAutoShip}`,
  trackingNumber: sql`COALESCE(${q.trackingNumber}, (SELECT s.tracking_number FROM shipments s WHERE s.order_id = ${q.id} AND s.label_status = 'Active' AND s.label_type = 'Shipping Label' ORDER BY s.label_created_at DESC LIMIT 1))`,
  rate: sql`${q.rate}`,
  salesPrice: sql`${q.salesPrice}`,
  pickListPrinted: sql`${q.pickListPrinted}`,
  orderDate: sql`${q.orderDate}`,
  expectedShipDate: sql`${q.expectedShipDate}`,
  carrierExpectedDeliveryDate: sql`${q.carrierExpectedDeliveryDate}`,
  shipCountry: sql`${q.shipCountry}`,
  orderTypeName: sql`COALESCE((SELECT lv.name FROM lookup_values lv WHERE lv.id = ${q.orderTypeId}), CASE ${q.orderType} WHEN 'B2B' THEN 'B2B Order' ELSE 'D2C Order' END)`,
  note: sql`${q.note}`,
  createdAt: sql`${q.createdAt}`,
  deliveredAt: sql`${q.deliveredAt}`,
  actualPickupDate: sql`${q.actualPickupDate}`,
  // The cell is the real ship date only: a cancelled order was never shipped (Cancel Date has its own column).
  shippedAt: sql`${q.shippedAt}`,
  shippingAccountNumber: sql`${q.shippingAccountNumber}`,
  taxDutiesAccountNumber: sql`${q.taxDutiesAccountNumber}`,
  isPrime: sql`${q.isPrime}`,
  isGift: sql`${q.isGift}`,
  priority: priorityRank,
  priorityRank,
  priorityLevel: sql`${q.priority}`,
  scheduledPickupDate: sql`${q.scheduledPickupDate}`,
  expectedDeliveryDate: sql`${q.expectedDeliveryDate}`,
  extraNote1: sql`${q.extraNote1}`,
  extraNote2: sql`${q.extraNote2}`,
  fraud: sql`${q.fraud}`,
  orderCodeGroupingRef: sql`${q.orderCodeGroupingRef}`,
  giftNote: sql`${q.giftNote}`,
  isBackOrder: sql`${q.isBackOrder}`,
  scheduledShipmentDate: sql`${q.scheduledShipmentDate}`,
  shipState: sql`${q.shipState}`,
  retailerId: sql`${q.retailerId}`,
  retailerName: sql`(SELECT r.name FROM retailers r WHERE r.id = ${q.retailerId})`,
  bol: sql`${q.bol}`,
  pro: sql`${q.pro}`,
  retailerPo: sql`${q.retailerPo}`,
  dept: sql`${q.dept}`,
  markFor: sql`${q.markFor}`,
  retailerCustomerAccount: sql`${q.retailerCustomerAccount}`,
  isUccLabelGenerated: sql`${q.isUccLabelGenerated}`,
  mergedOrderCode: sql`(SELECT m.code FROM shipment_orders m WHERE m.id = ${q.mergedIntoOrderId})`,
  mergedOrderStatus: sql`(SELECT m.status FROM shipment_orders m WHERE m.id = ${q.mergedIntoOrderId})`,
  cancelReason: sql`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${q.cancelReasonId})`,
  cancelledAt: sql`${q.cancelledAt}`,
  addressVerificationStatus: sql`${q.addressVerificationStatus}`,
  canceledByMerge: sql`(${q.mergedIntoOrderId} IS NOT NULL AND ${q.status} = 'Cancelled')`,
  isMerged: sql`(${q.isMerged} = 1 OR ${q.mergedIntoOrderId} IS NOT NULL)`,
  hasAllocatedInventory: sql`EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = ${q.id} AND l.allocated_quantity > 0)`,
  hasLabel: sql`EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = ${q.id} AND s.label_status = 'Active' AND s.label_type = 'Shipping Label')`,
  // No order has a printed issue label until the pick/pack short label printout ships (renderer is not configured).
  hasPickShortLabelPrinted: sql`0`,
  isPartial: sql`(${q.status} = 'Partially Shipped')`,
  singleItemOrder: sql`(${q.totalQuantity} = 1)`,
  tag: sql`(SELECT et.tag_id FROM entity_tags et WHERE et.entity_type = 'shipment_order' AND et.entity_id = ${q.id})`,
  cfDate1: cf("date1"), cfDate2: cf("date2"), cfDate3: cf("date3"),
  cfDropDown1: cf("dropDown1"), cfDropDown2: cf("dropDown2"),
  cfTextBox1: cf("textBox1"), cfTextBox2: cf("textBox2"), cfTextBox3: cf("textBox3"),
  cfToggle1: cf("toggle1"), cfToggle2: cf("toggle2"),
};

const warned = new Set<string>();

/** Logs an unmapped field once per process instead of failing the whole grid (a def/SQL-map mismatch must never 500 the list). */
function warnUnmapped(field: string, where: string): void {
  const key = `${where}:${field}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`orders-grid: no SQL for ${where} field "${field}"; it is skipped.`);
}

/** SQL for a column / filter field, or undefined (logged) when the field is not mapped. */
export function tryOrderExpr(field: string, where = "column"): SQL | undefined {
  const expr = ORDER_SQL[field];
  if (!expr) warnUnmapped(field, where);
  return expr;
}

export function orderExpr(field: string): SQL {
  const expr = ORDER_SQL[field];
  if (!expr) throw new Error(`orders-grid: no SQL for field "${field}"`);
  return expr;
}

/** Tag filter: an order matches `in` when ANY of its tags is selected. */
function tagFilterDef(): FilterFieldDef {
  return { key: "tag", label: "Tag", type: "enum", sql: sql`${q.id}`, nullable: true };
}

/**
 * Filter SQL that differs from the column SQL:
 * - `priority` (saved views: "High or Urgent") speaks in levels;
 * - `shippedAt`: the Shipped & Canceled default chip ("Actual Shipment Date: Last 7 days")
 *   also matches orders cancelled in the window, while the cell shows only a real ship date.
 */
const FILTER_SQL: Readonly<Record<string, SQL>> = {
  priority: sql`${q.priority}`,
  shippedAt: sql`COALESCE(${q.shippedAt}, ${q.cancelledAt})`,
};

/** Sort SQL that differs from the column SQL: shipped / cancelled orders sort together by their close date. */
const SORT_SQL: Readonly<Record<string, SQL>> = { shippedAt: sql`COALESCE(${q.shippedAt}, ${q.cancelledAt})` };

/** Server filter defs derived from the shared field list; an unmapped field is skipped (logged), never fatal. */
export const ORDER_FILTER_DEFS: readonly FilterFieldDef[] = ORDER_FILTER_FIELDS.flatMap((f): FilterFieldDef[] => {
  if (f.field === "tag") return [tagFilterDef()];
  const expr = FILTER_SQL[f.field] ?? tryOrderExpr(f.field, "filter");
  return expr ? [{ key: f.field, label: f.label, type: f.type, sql: expr, nullable: true }] : [];
});

/** `f.tag=in:a,b` is rewritten to an EXISTS over entity_tags (multi-valued field). */
function compileTagFilters(query: GridQuery): { readonly rest: GridQuery["filters"]; readonly sql: SQL[] } {
  const parts: SQL[] = [];
  const rest = query.filters.filter((f) => {
    if (f.field !== "tag") return true;
    const exists = (ids: readonly string[]) =>
      sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'shipment_order' AND et.entity_id = ${q.id} AND et.tag_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`;
    const any = sql`EXISTS (SELECT 1 FROM entity_tags et WHERE et.entity_type = 'shipment_order' AND et.entity_id = ${q.id})`;
    if (f.op === "in" && f.values.length) parts.push(exists(f.values));
    else if (f.op === "nin" && f.values.length) parts.push(sql`NOT ${exists(f.values)}`);
    else if (f.op === "ex") parts.push(any);
    else if (f.op === "empty") parts.push(sql`NOT ${any}`);
    else throw new AppError("VALIDATION", "Tag: operator not supported", { fieldErrors: { "f.tag": ["Unsupported operator"] } });
    return false;
  });
  return { rest, sql: parts };
}

/**
 * `f.sku=<op>:…` is line-wise: an order matches when ANY of its lines' SKU matches (so a
 * multi-line order is found by each of its SKUs). `nin` / `empty` mean NO line matches / no lines.
 */
function compileSkuFilters(filters: GridQuery["filters"]): { readonly rest: GridQuery["filters"]; readonly sql: SQL[] } {
  const parts: SQL[] = [];
  const lineSkuDef: FilterFieldDef = { key: "sku", label: "SKU", type: "text", sql: sql`p.sku`, nullable: true };
  const lineExists = (pred: SQL | undefined) =>
    sql`EXISTS (SELECT 1 FROM order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ${q.id}${pred ? sql` AND ${pred}` : sql``})`;
  const rest = filters.filter((f) => {
    if (f.field !== "sku") return true;
    if (f.op === "empty") parts.push(sql`NOT ${lineExists(undefined)}`);
    else if (f.op === "ex") parts.push(lineExists(undefined));
    else if (f.op === "nin") parts.push(sql`NOT ${lineExists(compileFilters([lineSkuDef], [{ field: "sku", op: "in", values: f.values }]))}`);
    else parts.push(lineExists(compileFilters([lineSkuDef], [f])));
    return false;
  });
  return { rest, sql: parts };
}

export interface OrderGridParams {
  readonly query: GridQuery;
  readonly where: SQL | undefined;
  readonly orderBy: readonly SQL[];
}

/** Parses and compiles the grammar; invalid params throw VALIDATION with field errors. */
export function orderGridParams(params: URLSearchParams): OrderGridParams {
  const { query, issues } = parseGridQuery(params);
  if (issues.length > 0) {
    const fieldErrors = Object.fromEntries(issues.map((i) => [i.param, [i.message]]));
    throw new AppError("VALIDATION", issues[0]?.message ?? "Invalid grid query", { fieldErrors });
  }
  return compileOrderGrid(query);
}

export function compileOrderGrid(query: GridQuery): OrderGridParams {
  const sortable = new Set<string>(ORDER_SORT_FIELDS);
  const unknownSort = query.sort.find((s) => !sortable.has(s.field));
  if (unknownSort) {
    throw new AppError("VALIDATION", `Cannot sort by "${unknownSort.field}"`, { fieldErrors: { sort: ["Unknown sort field"] } });
  }
  const tags = compileTagFilters(query);
  const skus = compileSkuFilters(tags.rest);
  const searchExprs = ORDER_SEARCH_FIELDS.map((f) => tryOrderExpr(f, "search")).filter((e): e is SQL => e !== undefined);
  const search = compileQuickSearch(query.q, query.qm, searchExprs);
  const known = new Set(ORDER_FILTER_DEFS.map((d) => d.key));
  const mapped = skus.rest.filter((f) => {
    if (known.has(f.field)) return true;
    warnUnmapped(f.field, "filter");
    return false;
  });
  const filters = compileFilters(ORDER_FILTER_DEFS, mapped);
  const parts = [search, filters, ...tags.sql, ...skus.sql].filter((p): p is SQL => p !== undefined);
  const where = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` AND `)})`;
  const orderBy = query.sort.flatMap((s) => {
    const expr = SORT_SQL[s.field] ?? tryOrderExpr(s.field, "sort");
    return expr ? [s.dir === "asc" ? asc(expr) : desc(expr)] : [];
  });
  return { query, where, orderBy };
}

/** True when the request speaks the grid grammar. */
export function isGridRequest(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (key === "q" || key === "qm" || key === "sort" || key === "ps" || key.startsWith("f.")) return true;
  }
  return false;
}
