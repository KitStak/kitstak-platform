/**
 * Post-replay history derived from the replayed orders: shipment plans for wholesale
 * orders, and the sales-channel integration log (runs, items, missing orders) consistent
 * with the orders each connection downloaded and shipped.
 */
import { and, asc, eq, gt, isNotNull, lte } from "drizzle-orm";
import type { SHIPMENT_PLAN_STATUSES } from "@/lib/enums";
import { INTEGRATION_ERROR_CODES } from "@/lib/integration-errors";
import * as schema from "@/server/db/schema";
import { changeLog, sequences } from "@/server/domain";
import type { Tx } from "@/server/domain/types";
import { REPLAY_DAYS } from "./outbound";
import { DAY_MS, HOUR_MS, MINUTE_MS, isoOf, utcAt } from "./runtime";
import { actor } from "./types";
import type { ChannelRef } from "./integrations";
import type { World } from "./world";

type PlanStatus = (typeof SHIPMENT_PLAN_STATUSES)[number];

function planStatusOf(statuses: readonly string[]): PlanStatus {
  if (statuses.every((s) => s === "Shipped" || s === "Delivered")) return "Shipped";
  if (statuses.every((s) => s === "Ready to Ship" || s === "Shipped" || s === "Delivered")) return "Loading Completed";
  if (statuses.some((s) => s === "Loading Started" || s === "Ready to Load" || s === "Ready to Ship")) return "Loading Started";
  if (statuses.some((s) => s !== "Open" && s !== "Shortage")) return "In Progress";
  return "Open";
}

/** Groups recent wholesale orders by retailer into 4 shipment plans. */
export function seedShipmentPlans(w: World, tx: Tx): number {
  const ctx = actor(w.access.manager);
  const b2b = tx.select().from(schema.shipmentOrders).where(and(eq(schema.shipmentOrders.warehouseId, w.facility.MLT1.id), eq(schema.shipmentOrders.channel, "Wholesale"),
    isNotNull(schema.shipmentOrders.retailerId))).orderBy(asc(schema.shipmentOrders.orderDate)).all().filter((o) => o.status !== "Cancelled");
  const groups: (typeof b2b)[] = [];
  const chunk = Math.max(1, Math.floor(b2b.length / 4));
  for (let i = 0; i < 4; i += 1) {
    const slice = b2b.slice(b2b.length - (4 - i) * chunk, b2b.length - (3 - i) * chunk || undefined).slice(0, 4);
    if (slice.length > 0) groups.push(slice);
  }
  groups.forEach((orders, i) => {
    const status = planStatusOf(orders.map((o) => o.status));
    const first = orders[0];
    const shipped = orders.map((o) => o.shippedAt).filter((s): s is string => Boolean(s)).sort().pop() ?? null;
    const code = sequences.next(tx, "shipmentPlan");
    const plan = tx.insert(schema.shipmentPlans).values({
      code, warehouseId: first.warehouseId, clientId: orders.every((o) => o.clientId === first.clientId) ? first.clientId : null,
      carrierConnectionId: w.carriers.sandboxByWarehouse.get(first.warehouseId) ?? null, retailerId: first.retailerId, status,
      truckPlateNumber: `KY ${String(4100 + i * 37)}-TR`, loadingGateLocationId: w.facility.MLT1.load[i % w.facility.MLT1.load.length],
      plannedShipmentAt: first.expectedShipDate, actualShipmentAt: status === "Shipped" ? shipped : null,
      loadingStartedAt: status === "Open" || status === "In Progress" ? null : isoOf(Date.parse(first.orderDate) + DAY_MS),
      loadingCompletedAt: status === "Loading Completed" || status === "Shipped" ? isoOf(Date.parse(first.orderDate) + DAY_MS + 2 * HOUR_MS) : null,
      truckDepartedAt: status === "Shipped" ? shipped : null,
      expectedTotalWeight: Math.round(orders.reduce((s, o) => s + o.totalWeightOz, 0) / 16), note: "Retailer appointment confirmed via routing portal.",
      createdBy: ctx.userId, createdAt: first.orderDate,
    }).returning({ id: schema.shipmentPlans.id }).get();
    tx.insert(schema.shipmentPlanOrders).values(orders.map((o) => ({ planId: plan.id, orderId: o.id, status, addedAt: o.orderDate }))).run();
    changeLog.recordCreate(tx, ctx, { entityType: "shipment_plan", entityId: plan.id, entityCode: code });
  });
  return groups.length;
}

/* ---------------------------------------------------------- channel history */

interface RunInput {
  readonly conn: ChannelRef;
  readonly method: "Download Orders" | "Download Products" | "Sync Inventory" | "Send Shipment Info";
  readonly startMs: number;
  readonly items: readonly { success: boolean; properties: Record<string, unknown>; error?: string; storeOrderNumber?: string | null; sellerSku?: string | null; qty?: number | null }[];
}

function insertRun(tx: Tx, r: RunInput): void {
  const methodId = r.conn.methods.get(r.method);
  if (!methodId) return;
  const ok = r.items.filter((i) => i.success).length;
  const status = r.items.length === 0 ? "No Data" : ok === r.items.length ? "Successful" : ok === 0 ? "Failed" : "Partially Successful";
  const run = tx.insert(schema.channelRuns).values({
    methodId, connectionId: r.conn.id, method: r.method, status, successCount: ok, errorCount: r.items.length - ok, totalCount: r.items.length,
    startedAt: isoOf(r.startMs), endedAt: isoOf(r.startMs + (8 + r.items.length * 2) * 1000),
  }).returning({ id: schema.channelRuns.id }).get();
  if (r.items.length > 0) {
    tx.insert(schema.channelRunItems).values(r.items.map((i, n) => ({
      runId: run.id, success: i.success, properties: JSON.stringify(i.properties), errorMessage: i.error ?? null,
      storeOrderNumber: i.storeOrderNumber ?? null, sellerSku: i.sellerSku ?? null, qty: i.qty ?? null, at: isoOf(r.startMs + (n + 1) * 1500),
    }))).run();
  }
  tx.update(schema.channelMethods).set({ lastRunAt: isoOf(r.startMs), nextRunAt: isoOf(r.startMs + 8 * HOUR_MS), ...(ok > 0 || r.items.length === 0 ? { lastSuccessAt: isoOf(r.startMs) } : {}) })
    .where(eq(schema.channelMethods.id, methodId)).run();
}

function ordersBetween(tx: Tx, conn: ChannelRef, fromMs: number, toMs: number) {
  return tx.select({ code: schema.shipmentOrders.code, store: schema.shipmentOrders.storeOrderNumber, qty: schema.shipmentOrders.totalQuantity })
    .from(schema.shipmentOrders).where(and(eq(schema.shipmentOrders.channelConnectionId, conn.id), gt(schema.shipmentOrders.orderDate, isoOf(fromMs)), lte(schema.shipmentOrders.orderDate, isoOf(toMs)))).all();
}

function shippedBetween(tx: Tx, conn: ChannelRef, fromMs: number, toMs: number) {
  return tx.select({ code: schema.shipmentOrders.code, store: schema.shipmentOrders.storeOrderNumber, tracking: schema.shipmentOrders.trackingNumber })
    .from(schema.shipmentOrders).where(and(eq(schema.shipmentOrders.channelConnectionId, conn.id), gt(schema.shipmentOrders.shippedAt, isoOf(fromMs)), lte(schema.shipmentOrders.shippedAt, isoOf(toMs)))).all();
}

function connectionRuns(w: World, tx: Tx, conn: ChannelRef): number {
  let runs = 0;
  const listings = tx.select({ sku: schema.productListings.sellerSku, productId: schema.productListings.productId }).from(schema.productListings)
    .where(eq(schema.productListings.channelConnectionId, conn.id)).all().filter((l) => l.productId).slice(0, 8);
  for (let d = REPLAY_DAYS - 1; d >= 0; d -= 1) {
    for (const hour of [6, 14, 22]) {
      const start = utcAt(d, hour, 3);
      if (start > w.endMs) continue;
      const orders = ordersBetween(tx, conn, start - 8 * HOUR_MS, start);
      const items = orders.map((o, i) => ({ success: !(d === 11 && i === 0), properties: { orderCode: o.code, storeOrderNumber: o.store, lines: o.qty },
        storeOrderNumber: o.store, ...(d === 11 && i === 0 ? { error: "Rate limited by the store API (HTTP 429); will retry on the next run." } : {}) }));
      insertRun(tx, { conn, method: "Download Orders", startMs: start, items });
      runs += 1;
    }
    const sync = utcAt(d, 9, 30);
    if (sync <= w.endMs) {
      insertRun(tx, { conn, method: "Sync Inventory", startMs: sync, items: listings.map((l, i) => ({ success: true, properties: { sku: l.sku, available: 20 + ((d * 7 + i * 13) % 140) }, sellerSku: l.sku, qty: 20 + ((d * 7 + i * 13) % 140) })) });
      const shipped = shippedBetween(tx, conn, sync - DAY_MS, sync);
      insertRun(tx, { conn, method: "Send Shipment Info", startMs: sync + 20 * MINUTE_MS, items: shipped.map((s) => ({ success: true, properties: { orderCode: s.code, trackingNumber: s.tracking }, storeOrderNumber: s.store })) });
      runs += 2;
    }
    if (d % 7 === 2) {
      insertRun(tx, { conn, method: "Download Products", startMs: utcAt(d, 4, 0), items: listings.slice(0, 4).map((l) => ({ success: true, properties: { sku: l.sku, action: "updated" }, sellerSku: l.sku })) });
      runs += 1;
    }
  }
  return runs;
}

function seedMissingOrders(w: World, tx: Tx): number {
  const conns = w.channels.connections.filter((c) => c.provider === "shopify");
  const codes = INTEGRATION_ERROR_CODES.slice(0, 9);
  codes.forEach((code, i) => {
    const conn = conns[i % conns.length];
    const ms = utcAt(1 + i * 2, 15, 12 + i);
    const number = `#${(conn.storeName.startsWith("Apex") ? 41_200 : 18_600) + i * 7}`;
    tx.insert(schema.channelMissingOrders).values({
      connectionId: conn.id, orderCode: `SHP-${String(980_000_100 + i * 37)}`, channelOrderNumber: number, orderDate: isoOf(ms), lastUpdated: isoOf(ms + 3 * HOUR_MS),
      lastErrorCode: code, payload: JSON.stringify({ id: `gid://shopify/Order/${5_600_100_000 + i}`, name: number, financial_status: "paid", line_items: i === 3 ? [] : [{ sku: "APX-TEE-BLK-M", quantity: 1 }] }),
      status: i === 8 ? "Resolved" : i % 3 === 0 ? "Retrying" : "Error",
    }).run();
  });
  return codes.length;
}

/** Writes channel runs (+ items) and missing orders. Returns the number of runs. */
export function seedChannelHistory(w: World, tx: Tx): number {
  const runs = w.channels.connections.reduce((s, c) => s + connectionRuns(w, tx, c), 0);
  seedMissingOrders(w, tx);
  return runs;
}
