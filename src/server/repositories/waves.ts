/**
 * Wave Log, Allocation Exceptions and Shortage Report repositories (M03, Logiwa 02 §3–§5)
 * plus the KitStaks additions Retry Allocation and Create Backorder.
 */
import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ALLOCATION_EXCEPTIONS_GRID, SHORTAGES_GRID, WAVE_LOG_GRID } from "@/lib/grid-defs/jobs/reports";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { scopedWhere } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { allocation, runBulk } from "@/server/domain";
import { createBackorder } from "@/server/domain/orders/commands";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { pageOffset } from "@/server/query/paginate";
import { asBool, compileGrid, type FieldSqlMap, qc } from "./jobs-grid";
import { runByDisplay } from "./waves-run-by";

const w = schema.waves;
const e = schema.allocationExceptions;
const s = schema.orderLineShortages;

/* ---------------------------------------------------------------- wave log */

export const WAVE_SQL: FieldSqlMap = {
  ruleName: sql`(SELECT r.name FROM wave_rules r WHERE r.id = ${qc(w.waveRuleId)})`,
  waveNo: sql`${qc(w.waveNo)}`,
  status: sql`${qc(w.status)}`,
  ordersMet: sql`${qc(w.ordersMet)}`,
  shortageOrders: sql`${qc(w.shortageOrders)}`,
  jobsCreated: sql`${qc(w.jobsCreated)}`,
  allocatedOrders: sql`${qc(w.allocatedOrders)}`,
  mergedOrders: sql`${qc(w.mergedOrders)}`,
  // Not stored: picking waves keep the invariant met = allocated + shortage + eliminated (see waves-run.ts).
  eliminatedOrders: sql`(CASE WHEN (SELECT r.operation_type FROM wave_rules r WHERE r.id = ${qc(w.waveRuleId)}) IN ('Picking', 'AI Job') AND ${qc(w.status)} = 'Completed' THEN MAX(0, ${qc(w.ordersMet)} - ${qc(w.allocatedOrders)} - ${qc(w.shortageOrders)}) ELSE 0 END)`,
  runAt: sql`${qc(w.runAt)}`,
  runBy: sql`COALESCE((SELECT u.name FROM users u WHERE u.email = ${qc(w.runBy)}), ${qc(w.runBy)})`,
  message: sql`${qc(w.message)}`,
  warehouse: sql`(SELECT x.name FROM warehouses x WHERE x.id = ${qc(w.warehouseId)})`,
  operationType: sql`(SELECT r.operation_type FROM wave_rules r WHERE r.id = ${qc(w.waveRuleId)})`,
};

export function listWaves(db: AppDb, auth: AuthContext, query: GridQuery) {
  const { where, orderBy } = compileGrid(query, WAVE_LOG_GRID, WAVE_SQL, {
    defaultSort: [{ field: "runAt", dir: "desc" }], tiebreaker: sql`${qc(w.id)}`, extra: [scopedWhere(w, auth.viewScope)],
  });
  const select: Record<string, SQL> = { id: sql`${qc(w.id)}`, waveRuleId: sql`${qc(w.waveRuleId)}`, finishedAt: sql`${qc(w.finishedAt)}`, ...WAVE_SQL };
  const rows = db.select(select).from(w).where(where).orderBy(...orderBy).limit(query.pageSize).offset(pageOffset(query)).all();
  const total = db.select({ n: count() }).from(w).where(where).get()?.n ?? 0;
  return { rows, total };
}

/* --------------------------------------------------- allocation exceptions */

export const EXCEPTION_SQL: FieldSqlMap = {
  orderCode: sql`(SELECT o.code FROM shipment_orders o WHERE o.id = ${qc(e.orderId)})`,
  waveNo: sql`${qc(e.waveNo)}`,
  waveRuleName: sql`${qc(e.waveRuleName)}`,
  algorithmRuleName: sql`${qc(e.algorithmRuleName)}`,
  shortageSku: sql`(SELECT p.sku FROM products p WHERE p.id = ${qc(e.shortageProductId)})`,
  inventoryUomQty: sql`${qc(e.inventoryUomQty)}`,
  orderLineQty: sql`${qc(e.orderLineQty)}`,
  algorithmName: sql`${qc(e.algorithmName)}`,
  explanation: sql`${qc(e.explanation)}`,
  isRolledBack: sql`${qc(e.isRolledBack)}`,
  // Display name, not the raw email (Logiwa shows names); the email stays filterable via the name.
  runBy: sql`COALESCE((SELECT u.name FROM users u WHERE u.email = ${qc(e.runBy)}), ${qc(e.runBy)})`,
  runAt: sql`${qc(e.runAt)}`,
  client: sql`(SELECT c.name FROM clients c WHERE c.id = ${qc(e.clientId)})`,
  warehouse: sql`(SELECT x.name FROM warehouses x WHERE x.id = ${qc(e.warehouseId)})`,
};

/**
 * One explanation per order per wave (critic R4): the order-level "Order bypassed: all items out of
 * stock" row is hidden when the same wave already lists the order's line-level SKU shortages.
 */
export const NOT_REDUNDANT_BYPASS: SQL = sql`NOT (${qc(e.shortageProductId)} IS NULL AND ${qc(e.explanation)} LIKE 'Order bypassed:%' AND EXISTS (SELECT 1 FROM allocation_exceptions x WHERE x.order_id = ${qc(e.orderId)} AND x.wave_id IS ${qc(e.waveId)} AND x.shortage_product_id IS NOT NULL))`;

export function listAllocationExceptions(db: AppDb, auth: AuthContext, query: GridQuery) {
  const { where, orderBy } = compileGrid(query, ALLOCATION_EXCEPTIONS_GRID, EXCEPTION_SQL, {
    defaultSort: [{ field: "runAt", dir: "desc" }], tiebreaker: sql`${qc(e.id)}`, extra: [scopedWhere(e, auth.viewScope), NOT_REDUNDANT_BYPASS],
  });
  const select: Record<string, SQL> = {
    id: sql`${qc(e.id)}`, orderId: sql`${qc(e.orderId)}`, waveId: sql`${qc(e.waveId)}`, warehouseId: sql`${qc(e.warehouseId)}`,
    orderStatus: sql`(SELECT o.status FROM shipment_orders o WHERE o.id = ${qc(e.orderId)})`, ...EXCEPTION_SQL,
  };
  const rows = db.select(select).from(e).where(where).orderBy(...orderBy).limit(query.pageSize).offset(pageOffset(query)).all() as Record<string, unknown>[];
  const total = db.select({ n: count() }).from(e).where(where).get()?.n ?? 0;
  return { rows: rows.map((r) => ({ ...r, isRolledBack: Boolean(r.isRolledBack) })), total };
}

/**
 * Retry Allocation (KitStaks addition) for orders, grouped by warehouse. Each order runs
 * through `allocation.allocateOrders` as "Manual Allocation"; Ready to Pick orders that
 * no longer need stock report success without re-allocating.
 */
export function retryAllocation(db: AppDb, ctx: DomainCtx, orderIds: readonly string[], runByInput: string): BulkResult & { readonly allocated: readonly string[] } {
  const runBy = runByDisplay(db, runByInput);
  const orders = db.select().from(schema.shipmentOrders).where(inArray(schema.shipmentOrders.id, [...new Set(orderIds)])).all();
  const failed: { id: string; code: string; message: string }[] = [];
  const succeeded: string[] = [];
  const allocated: string[] = [];
  const byWarehouse = new Map<string, string[]>();
  for (const id of new Set(orderIds)) {
    const order = orders.find((o) => o.id === id);
    if (!order) { failed.push({ id, code: "NOT_FOUND", message: "Order not found" }); continue; }
    if (order.status !== "Open" && order.status !== "Shortage") {
      failed.push({ id, code: "INVALID_STATE", message: `Order ${order.code} is ${order.status}; only Open or Shortage orders can be allocated.` });
      continue;
    }
    byWarehouse.set(order.warehouseId, [...(byWarehouse.get(order.warehouseId) ?? []), id]);
  }
  for (const [warehouseId, ids] of byWarehouse) {
    const res = allocation.allocateOrders(db, ctx, { orderIds: ids, warehouseId, runBy });
    allocated.push(...res.allocated);
    succeeded.push(...res.allocated);
    for (const id of res.shortage) {
      const code = orders.find((o) => o.id === id)?.code ?? id;
      failed.push({ id, code: "INSUFFICIENT_STOCK", message: `Order ${code} is still short of stock.` });
    }
    failed.push(...res.failed);
  }
  return { succeeded, failed, allocated };
}

/* -------------------------------------------------------- shortage report */

const lineCol = (col: string): SQL => sql`(SELECT l.${sql.raw(col)} FROM order_lines l WHERE l.id = ${qc(s.orderLineId)})`;
const orderCol = (col: string): SQL => sql`(SELECT o.${sql.raw(col)} FROM shipment_orders o WHERE o.id = ${qc(s.orderId)})`;
const productCol = (col: string): SQL => sql`(SELECT p.${sql.raw(col)} FROM order_lines l JOIN products p ON p.id = l.product_id WHERE l.id = ${qc(s.orderLineId)})`;
const uom = sql`COALESCE((SELECT pt.uom_qty FROM order_lines l JOIN product_pack_types pt ON pt.product_id = l.product_id AND pt.pack_type = l.pack_type WHERE l.id = ${qc(s.orderLineId)} LIMIT 1), 1)`;

export const SHORTAGE_SQL: FieldSqlMap = {
  orderCode: orderCol("code"),
  storeOrderNumber: orderCol("store_order_number"),
  sku: productCol("sku"),
  productName: productCol("name"),
  orderDate: orderCol("order_date"),
  orderType: sql`(SELECT COALESCE(lv.name, (SELECT lx.name FROM lookup_values lx WHERE lx.type = 'so_type' AND (lx.name = o.order_type OR lx.code = o.order_type OR lx.name LIKE o.order_type || ' %') ORDER BY lx.sort_order LIMIT 1), o.order_type) FROM shipment_orders o LEFT JOIN lookup_values lv ON lv.id = o.order_type_id WHERE o.id = ${qc(s.orderId)})`,
  reason: sql`${qc(s.reason)}`,
  missingTriggered: asBool(sql`${qc(s.missingTriggered)} = 1`),
  orderStatus: orderCol("status"),
  linePackQty: sql`(SELECT l.quantity - l.cancelled_quantity FROM order_lines l WHERE l.id = ${qc(s.orderLineId)})`,
  packType: lineCol("pack_type"),
  shortageQty: sql`${qc(s.shortageQty)}`,
  shortageUomQty: sql`(${qc(s.shortageQty)} * ${uom})`,
  freeQty: sql`${qc(s.freeQty)}`,
  freeUomQty: sql`(${qc(s.freeQty)} * ${uom})`,
  damagedQty: sql`${qc(s.damagedQty)}`,
  damagedUomQty: sql`(${qc(s.damagedQty)} * ${uom})`,
  onHandQty: sql`${qc(s.onHandQty)}`,
  onHandUomQty: sql`(${qc(s.onHandQty)} * ${uom})`,
  lastTrialAt: sql`${qc(s.lastTrialAt)}`,
  warehouse: sql`(SELECT x.name FROM shipment_orders o JOIN warehouses x ON x.id = o.warehouse_id WHERE o.id = ${qc(s.orderId)})`,
  client: sql`(SELECT c.name FROM shipment_orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ${qc(s.orderId)})`,
  orderAge: sql`(SELECT CAST(julianday('now') - julianday(o.order_date) AS INTEGER) FROM shipment_orders o WHERE o.id = ${qc(s.orderId)})`,
  expectedShipDate: orderCol("expected_ship_date"),
  masterOrderCode: sql`(SELECT m.code FROM shipment_orders o JOIN shipment_orders m ON m.id = o.master_order_id WHERE o.id = ${qc(s.orderId)})`,
};

const shortageScope = (auth: AuthContext): SQL | undefined => {
  const inner = scopedWhere(schema.shipmentOrders, auth.viewScope);
  return inner ? sql`EXISTS (SELECT 1 FROM ${schema.shipmentOrders} WHERE ${schema.shipmentOrders.id} = ${qc(s.orderId)} AND ${inner})` : undefined;
};

export function listShortages(db: AppDb, auth: AuthContext, query: GridQuery) {
  const { where, orderBy } = compileGrid(query, SHORTAGES_GRID, SHORTAGE_SQL, {
    defaultSort: [{ field: "lastTrialAt", dir: "desc" }], tiebreaker: sql`${qc(s.id)}`, extra: [shortageScope(auth), sql`${qc(s.resolvedAt)} IS NULL`],
  });
  const select: Record<string, SQL> = {
    id: sql`${qc(s.id)}`, orderId: sql`${qc(s.orderId)}`, orderLineId: sql`${qc(s.orderLineId)}`, productId: lineCol("product_id"),
    allocatedQty: lineCol("allocated_quantity"), ...SHORTAGE_SQL,
  };
  const rows = db.select(select).from(s).where(where).orderBy(...orderBy).limit(query.pageSize).offset(pageOffset(query)).all() as Record<string, unknown>[];
  const total = db.select({ n: count() }).from(s).where(where).get()?.n ?? 0;
  return { rows: rows.map((r) => ({ ...r, missingTriggered: Boolean(r.missingTriggered) })), total };
}

/**
 * Maps shortage-line ids to their distinct open orders inside the caller's scope. Ids that
 * do not exist, are already resolved, or are out of scope come back in `missing`.
 */
export function resolveShortageIds(db: AppDb, auth: AuthContext, shortageIds: readonly string[]): { orderIds: string[]; missing: string[] } {
  const ids = [...new Set(shortageIds)];
  if (ids.length === 0) return { orderIds: [], missing: [] };
  const rows = db.select({ id: s.id, orderId: s.orderId }).from(s)
    .where(and(inArray(s.id, ids), sql`${qc(s.resolvedAt)} IS NULL`, shortageScope(auth))).all();
  const found = new Set(rows.map((r) => r.id));
  return { orderIds: [...new Set(rows.map((r) => r.orderId))], missing: ids.filter((id) => !found.has(id)) };
}

export function shortageOrderIds(db: AppDb, shortageIds: readonly string[]): string[] {
  if (shortageIds.length === 0) return [];
  return [...new Set(db.select({ id: s.orderId }).from(s).where(inArray(s.id, [...shortageIds])).all().map((r) => r.id))];
}

/** Create Backorder for each distinct order of the selected shortage rows. */
export function createBackorders(db: AppDb, ctx: DomainCtx, orderIds: readonly string[]): BulkResult {
  return runBulk(db, orderIds, (tx, id) => {
    createBackorder(tx, ctx, { orderId: id });
  });
}

export function orderIdsOfExceptions(db: AppDb, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  return [...new Set(db.select({ id: e.orderId }).from(e).where(inArray(e.id, [...ids])).all().map((r) => r.id))];
}

export function waveById(db: AppDb, id: string) {
  return db.select().from(w).where(eq(w.id, id)).get() ?? null;
}
