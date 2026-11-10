/**
 * Return Station commands (M04 §3–5): RMA lookup by RMA / order / tracking number,
 * product resolution by scan, receiving with dispositions (Restock / Damaged /
 * Quarantine / Dispose) through `ledger.recordReceipt` (type Return → ledger Return
 * Receiving), Manual RMA creation, status roll-up, client notifications and KPIs.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { RETURN_DISPOSITIONS } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { assertInScope, hasClient, hasWarehouse } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, notify, sequences, stateMachines } from "@/server/domain";
import { validationError } from "@/server/api/errors";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx } from "@/server/domain/types";
import { idSchema } from "./platform-common";
import { loadReturn } from "./returns";

type Ctx = DomainCtx & { readonly scope: Scope };

const RECEIVABLE = ["Pending", "In Transit", "Started"] as const;

/* ---------------------------------------------------------------- lookup */

export interface RmaCandidate {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly orderCode: string | null;
  readonly customerName: string | null;
  readonly trackingNumber: string | null;
  readonly clientName: string;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly receivable: boolean;
  readonly reason: string | null;
}

/** Finds RMAs by RMA code, shipment order code / store order #, or (return) tracking number. */
export function lookupRmas(db: AppDb, scope: Scope, warehouseId: string, code: string): RmaCandidate[] {
  const c = code.trim();
  if (!c) throw new DomainError("VALIDATION", "Scan or enter an RMA, order code or tracking number");
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const lc = c.toLowerCase();
  const rows = db.all<{ id: string; rmaCode: string; status: string; orderCode: string | null; customerName: string | null; trackingNumber: string | null; clientId: string; clientName: string; warehouseId: string; requestedQty: number; returnedQty: number }>(sql`
    SELECT ro.id, ro.rma_code AS rmaCode, ro.status, so.code AS orderCode, COALESCE(ro.customer_name, so.customer_name) AS customerName,
      ro.tracking_number AS trackingNumber, ro.client_id AS clientId, c.name AS clientName, ro.warehouse_id AS warehouseId,
      (SELECT COALESCE(SUM(requested_qty),0) FROM return_order_lines WHERE return_order_id = ro.id) AS requestedQty,
      (SELECT COALESCE(SUM(returned_qty),0) FROM return_order_lines WHERE return_order_id = ro.id) AS returnedQty
    FROM return_orders ro JOIN clients c ON c.id = ro.client_id LEFT JOIN shipment_orders so ON so.id = ro.shipment_order_id
    WHERE ro.warehouse_id = ${warehouseId} AND (lower(ro.rma_code) = ${lc} OR lower(so.code) = ${lc} OR lower(so.store_order_number) = ${lc}
      OR lower(ro.tracking_number) = ${lc} OR lower(so.tracking_number) = ${lc})
    ORDER BY ro.created_at DESC LIMIT 50`);
  return rows.filter((r) => hasClient(scope, r.clientId)).map((r) => {
    const receivable = (RECEIVABLE as readonly string[]).includes(r.status);
    return {
      id: r.id, rmaCode: r.rmaCode, status: r.status, orderCode: r.orderCode, customerName: r.customerName, trackingNumber: r.trackingNumber,
      clientName: r.clientName, requestedQty: r.requestedQty, returnedQty: r.returnedQty, receivable,
      reason: receivable ? null : `RMA ${r.rmaCode} is ${r.status.toLowerCase()} and can't be received.`,
    };
  });
}

export interface ResolvedProduct {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly clientId: string;
  readonly trackSerial: boolean;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
}

/** Exact SKU / barcode / pack-type barcode match within a client. */
export function resolveProduct(db: AppDb, scope: Scope, clientId: string, code: string): ResolvedProduct | null {
  if (!hasClient(scope, clientId)) throw new DomainError("NOT_FOUND", "Client not found");
  const lc = code.trim().toLowerCase();
  if (!lc) return null;
  const p = schema.products;
  const viaBarcode = db.select({ id: schema.productBarcodes.productId }).from(schema.productBarcodes).where(sql`lower(${schema.productBarcodes.barcode}) = ${lc}`).all().map((r) => r.id);
  const row = db.select().from(p).where(and(eq(p.clientId, clientId), or(sql`lower(${p.sku}) = ${lc}`, sql`lower(${p.barcode}) = ${lc}`, viaBarcode.length ? inArray(p.id, viaBarcode) : undefined))).get();
  if (!row) return null;
  return { id: row.id, sku: row.sku, name: row.name, imageUrl: row.imageUrl, uom: row.uom, clientId: row.clientId, trackSerial: row.trackSerial, trackLot: row.trackLot, trackExpiry: row.trackExpiry };
}

/* --------------------------------------------------------------- receive */

const itemSchema = z.object({
  returnOrderLineId: idSchema.nullish(),
  productId: idSchema,
  quantity: z.number().int().min(1, "Quantity must be at least 1").max(100000),
  disposition: z.enum(RETURN_DISPOSITIONS),
  damageReasonId: idSchema.nullish(),
  actualReturnReasonId: idSchema.nullish(),
  lotNumber: z.string().trim().max(120).nullish(),
  expiryDate: z.string().trim().max(40).nullish(),
  serials: z.array(z.string().trim().min(1).max(120)).max(1000).optional(),
  note: z.string().trim().max(500).nullish(),
});

const targetSchema = z.object({
  stationLocationId: idSchema,
  targetLocationId: idSchema.nullish(),
  targetLpId: idSchema.nullish(),
});

export const receiveRmaSchema = targetSchema.extend({
  returnOrderId: idSchema,
  items: z.array(itemSchema).min(1, "Scan at least one item"),
  complete: z.boolean().default(true),
});

export const receiveManualSchema = targetSchema.extend({
  warehouseId: idSchema,
  clientId: idSchema,
  shipmentOrderId: idSchema.nullish(),
  customerName: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(1000).nullish(),
  items: z.array(itemSchema.omit({ returnOrderLineId: true })).min(1, "Add at least one product"),
});

export type ReceiveItem = z.output<typeof itemSchema>;

export interface ReceiveResult {
  readonly returnOrderId: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly receivedQty: number;
  readonly receiptIds: readonly string[];
  readonly notified: number;
}

interface Placement {
  readonly warehouseId: string;
  readonly stationLocationId: string;
  readonly targetLocationId: string;
  readonly targetLpId: string | null;
}

function resolvePlacement(tx: AppDb, warehouseId: string, input: z.output<typeof targetSchema>): Placement {
  const station = tx.select().from(schema.locations).where(eq(schema.locations.id, input.stationLocationId)).get();
  if (!station || station.warehouseId !== warehouseId) throw validationError("Choose a return station in the receiving warehouse", { stationLocationId: ["Station is in another warehouse"] });
  if (input.targetLpId) {
    const lp = tx.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, input.targetLpId)).get();
    if (!lp || lp.warehouseId !== warehouseId) throw validationError("Target LP not found in this warehouse", { targetLpId: ["LP not found"] });
    return { warehouseId, stationLocationId: station.id, targetLocationId: lp.locationId ?? station.id, targetLpId: lp.id };
  }
  if (input.targetLocationId) {
    const loc = tx.select().from(schema.locations).where(eq(schema.locations.id, input.targetLocationId)).get();
    if (!loc || loc.warehouseId !== warehouseId) throw validationError("Target location not found in this warehouse", { targetLocationId: ["Location not found"] });
    return { warehouseId, stationLocationId: station.id, targetLocationId: loc.id, targetLpId: null };
  }
  return { warehouseId, stationLocationId: station.id, targetLocationId: station.id, targetLpId: null };
}

const lookupName = (tx: AppDb, id: string | null | undefined): string | null =>
  id ? tx.select({ name: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get()?.name ?? null : null;

/** Posts one item: receipt (ledger Return Receiving) then the disposition move/removal. */
function postItem(tx: AppDb, ctx: Ctx, ro: typeof schema.returnOrders.$inferSelect, place: Placement, item: ReceiveItem, lineId: string): string {
  const product = tx.select().from(schema.products).where(eq(schema.products.id, item.productId)).get();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const line = tx.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, lineId)).get();
  const damageReason = item.disposition === "Damaged" ? lookupName(tx, item.damageReasonId) ?? "Customer Return - Damaged" : null;
  const actualReason = lookupName(tx, item.actualReturnReasonId);
  const toStation = item.disposition === "Quarantine" || item.disposition === "Dispose";
  const { receipt, txn } = ledger.recordReceipt(tx, ctx, {
    type: "Return", warehouseId: place.warehouseId, clientId: ro.clientId, productId: product.id, packType: line?.packType ?? product.uom,
    quantity: item.quantity, locationId: toStation ? place.stationLocationId : place.targetLocationId, lpId: toStation ? null : place.targetLpId,
    lotNumber: item.lotNumber ?? null, expiryDate: item.expiryDate ?? null, damageReason,
    returnOrderId: ro.id, returnOrderLineId: lineId, shipmentOrderId: ro.shipmentOrderId,
    customerReturnReason: lookupName(tx, line?.customerReturnReasonId), actualReturnReason: actualReason,
    note: [`${item.disposition} · ${ro.rmaCode}`, item.note].filter(Boolean).join(" · "),
    serials: item.serials?.map((primary) => ({ primary })),
  });
  if (item.disposition === "Dispose" && txn.toInventoryId) {
    ledger.remove(tx, ctx, { inventoryId: txn.toInventoryId, qty: txn.uomQty, type: "Inventory Adjustment", refs: { returnOrderId: ro.id, receiptId: receipt.id, note: `Disposed on return ${ro.rmaCode}` } });
  }
  const before = line ? { disposition: line.disposition, actualReturnReasonId: line.actualReturnReasonId } : {};
  tx.update(schema.returnOrderLines).set({ disposition: item.disposition, actualReturnReasonId: item.actualReturnReasonId ?? line?.actualReturnReasonId ?? null, updatedBy: ctx.userId })
    .where(eq(schema.returnOrderLines.id, lineId)).run();
  changeLog.recordLine(tx, ctx, {
    entityType: "return_order", entityId: ro.id, entityCode: ro.rmaCode, lineEntityType: "return_order_line", lineEntityId: lineId,
    lineLabel: product.sku, field: "returnedQty", from: line?.returnedQty ?? 0, to: (line?.returnedQty ?? 0) + item.quantity,
  });
  if (line && line.disposition !== item.disposition) {
    changeLog.recordUpdate(tx, ctx, { entityType: "return_order", entityId: ro.id, entityCode: ro.rmaCode, before, after: { disposition: item.disposition } });
  }
  return receipt.id;
}

/** Line and RMA status roll-up after receiving. */
function rollup(tx: AppDb, ctx: Ctx, returnOrderId: string, complete: boolean): typeof schema.returnOrders.$inferSelect {
  const lines = tx.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.returnOrderId, returnOrderId)).all();
  for (const l of lines) {
    const status = l.returnedQty >= l.requestedQty ? "Completed" : l.returnedQty > 0 ? "Started" : l.lineStatus;
    if (status !== l.lineStatus) tx.update(schema.returnOrderLines).set({ lineStatus: status }).where(eq(schema.returnOrderLines.id, l.id)).run();
  }
  const ro = tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, returnOrderId)).get() as typeof schema.returnOrders.$inferSelect;
  const allDone = lines.every((l) => l.returnedQty >= l.requestedQty);
  if ((allDone || complete) && ro.status !== "Completed" && lines.some((l) => l.returnedQty > 0)) {
    const status = stateMachines.returnOrder.transition(ro.status, "Completed");
    const after = tx.update(schema.returnOrders).set({ status, actualReturnDate: ro.actualReturnDate ?? new Date().toISOString(), updatedBy: ctx.userId, version: sql`${schema.returnOrders.version} + 1` })
      .where(eq(schema.returnOrders.id, ro.id)).returning().get();
    if (complete) tx.update(schema.returnOrderLines).set({ lineStatus: "Completed" }).where(eq(schema.returnOrderLines.returnOrderId, ro.id)).run();
    changeLog.recordUpdate(tx, ctx, { entityType: "return_order", entityId: ro.id, entityCode: ro.rmaCode, before: { status: ro.status }, after: { status } });
    return after;
  }
  return ro;
}

function notifyClient(tx: AppDb, ro: typeof schema.returnOrders.$inferSelect, qty: number): number {
  const userIds = tx.select({ id: schema.userClients.userId }).from(schema.userClients).where(eq(schema.userClients.clientId, ro.clientId)).all().map((r) => r.id);
  return notify(tx, userIds, {
    kind: "return.received", title: `Return ${ro.rmaCode} received`,
    body: `${qty} ${qty === 1 ? "unit was" : "units were"} received. Status: ${ro.status}.`, href: `/orders/returns/${ro.id}`, severity: "success",
  });
}

export function receiveRma(tx: AppDb, ctx: Ctx, input: z.output<typeof receiveRmaSchema>): ReceiveResult {
  const ro = loadReturn(tx, ctx.scope, input.returnOrderId);
  if (!(RECEIVABLE as readonly string[]).includes(ro.status)) throw new DomainError("INVALID_STATE", `RMA ${ro.rmaCode} is ${ro.status.toLowerCase()} and can't be received.`);
  const place = resolvePlacement(tx, ro.warehouseId, input);
  const lines = tx.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.returnOrderId, ro.id)).all();
  const pending = new Map(lines.map((l) => [l.id, l.requestedQty - l.returnedQty]));
  const fieldErrors: Record<string, string[]> = {};
  input.items.forEach((item, i) => {
    const line = lines.find((l) => l.id === item.returnOrderLineId) ?? lines.find((l) => l.productId === item.productId && (pending.get(l.id) ?? 0) > 0);
    if (!line) { fieldErrors[`items.${i}.productId`] = ["This product is not on the RMA"]; return; }
    const left = pending.get(line.id) ?? 0;
    if (item.quantity > left) fieldErrors[`items.${i}.quantity`] = [left === 0 ? "Already fully received" : `Max ${left} left to receive`];
    pending.set(line.id, left - item.quantity);
    if (item.disposition === "Damaged" && !item.damageReasonId) fieldErrors[`items.${i}.damageReasonId`] = ["Choose a damage reason"];
  });
  if (Object.keys(fieldErrors).length > 0) throw validationError(Object.values(fieldErrors)[0]?.[0] ?? "Invalid items", fieldErrors);
  const remaining = new Map(lines.map((l) => [l.id, l.requestedQty - l.returnedQty]));
  const receiptIds = input.items.map((item) => {
    const line = lines.find((l) => l.id === item.returnOrderLineId) ?? lines.find((l) => l.productId === item.productId && (remaining.get(l.id) ?? 0) > 0);
    if (!line) throw new DomainError("VALIDATION", "This product is not on the RMA");
    remaining.set(line.id, (remaining.get(line.id) ?? 0) - item.quantity);
    return postItem(tx, ctx, tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).get() ?? ro, place, item, line.id);
  });
  const after = rollup(tx, ctx, ro.id, input.complete);
  const qty = input.items.reduce((s, i) => s + i.quantity, 0);
  const notified = notifyClient(tx, after, qty);
  return { returnOrderId: ro.id, rmaCode: ro.rmaCode, status: after.status, receivedQty: qty, receiptIds, notified };
}

/** Return Manually: creates a Manual RMA for the client (optional order) and receives it. */
export function receiveManual(tx: AppDb, ctx: Ctx, input: z.output<typeof receiveManualSchema>): ReceiveResult {
  if (!hasWarehouse(ctx.scope, input.warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  if (!hasClient(ctx.scope, input.clientId)) throw new DomainError("NOT_FOUND", "Client not found");
  let order: typeof schema.shipmentOrders.$inferSelect | undefined;
  if (input.shipmentOrderId) {
    order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, input.shipmentOrderId)).get();
    assertInScope(ctx.scope, order, "Shipment order");
    if (order?.clientId !== input.clientId) throw validationError("The order belongs to another client", { shipmentOrderId: ["Order belongs to another client"] });
  }
  const fieldErrors: Record<string, string[]> = {};
  input.items.forEach((item, i) => {
    const p = tx.select({ clientId: schema.products.clientId }).from(schema.products).where(eq(schema.products.id, item.productId)).get();
    if (!p || p.clientId !== input.clientId) fieldErrors[`items.${i}.productId`] = ["Product belongs to another client"];
    if (item.disposition === "Damaged" && !item.damageReasonId) fieldErrors[`items.${i}.damageReasonId`] = ["Choose a damage reason"];
  });
  if (Object.keys(fieldErrors).length > 0) throw validationError(Object.values(fieldErrors)[0]?.[0] ?? "Invalid items", fieldErrors);
  const place = resolvePlacement(tx, input.warehouseId, input);
  const rmaCode = sequences.next(tx, "rma");
  const ro = tx.insert(schema.returnOrders).values({
    rmaCode, shipmentOrderId: order?.id ?? null, warehouseId: input.warehouseId, clientId: input.clientId, source: "Manual", status: "Pending",
    customerName: input.customerName ?? order?.customerName ?? null, fromCountry: order?.shipCountry ?? null, note: input.note ?? null,
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "return_order", entityId: ro.id, entityCode: rmaCode });
  const receiptIds = input.items.map((item) => {
    const product = tx.select().from(schema.products).where(eq(schema.products.id, item.productId)).get();
    const orderLine = order ? tx.select().from(schema.orderLines).where(and(eq(schema.orderLines.orderId, order.id), eq(schema.orderLines.productId, item.productId))).get() : undefined;
    const line = tx.insert(schema.returnOrderLines).values({
      returnOrderId: ro.id, orderLineId: orderLine?.id ?? null, productId: item.productId, packType: orderLine?.packType ?? product?.uom ?? "Unit",
      requestedQty: item.quantity, actualReturnReasonId: item.actualReturnReasonId ?? null, createdBy: ctx.userId,
    }).returning().get();
    return postItem(tx, ctx, tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).get() ?? ro, place, { ...item, returnOrderLineId: line.id }, line.id);
  });
  const after = rollup(tx, ctx, ro.id, true);
  const qty = input.items.reduce((s, i) => s + i.quantity, 0);
  return { returnOrderId: ro.id, rmaCode, status: after.status, receivedQty: qty, receiptIds, notified: notifyClient(tx, after, qty) };
}

/* ------------------------------------------------------------------ KPIs */

export interface ReturnStationKpis {
  readonly returnedOrdersToday: number;
  readonly returnedProductsToday: number;
  readonly openReturns: number;
}

export function returnStationKpis(db: AppDb, scope: Scope, warehouseId: string, userSource: string, now = new Date()): ReturnStationKpis {
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const today = db.get<{ orders: number; units: number }>(sql`SELECT COUNT(DISTINCT return_order_id) AS orders, COALESCE(SUM(quantity),0) AS units
    FROM receipts WHERE type = 'Return' AND warehouse_id = ${warehouseId} AND received_by = ${userSource} AND received_at >= ${since} AND cancelled_at IS NULL`);
  const clients = scope.clientIds === "all" ? sql`1 = 1` : scope.clientIds.length ? sql`client_id IN (${sql.join(scope.clientIds.map((c) => sql`${c}`), sql`, `)})` : sql`0 = 1`;
  const open = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM return_orders WHERE warehouse_id = ${warehouseId} AND status IN ('Pending','In Transit','Started') AND ${clients}`);
  return { returnedOrdersToday: today?.orders ?? 0, returnedProductsToday: today?.units ?? 0, openReturns: open?.n ?? 0 };
}

/* -------------------------------------------------------- station setup */

export interface StationOption {
  readonly id: string;
  readonly code: string;
  readonly kind: "location" | "lp";
  readonly detail: string | null;
}

/** Return Station locations: active Returns-area locations of the warehouse. */
export function returnStations(db: AppDb, scope: Scope, warehouseId: string): StationOption[] {
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  return db.all<{ id: string; code: string; detail: string | null }>(sql`SELECT id, code, location_type AS detail FROM locations
    WHERE warehouse_id = ${warehouseId} AND area_type = 'Returns' AND is_active = 1 ORDER BY code`).map((r) => ({ ...r, kind: "location" as const }));
}

export const targetQuerySchema = z.object({
  warehouseId: idSchema,
  kind: z.enum(["location", "lp"]),
  q: z.string().trim().max(60).optional(),
});

/** Return target candidates: locations (Returns area first) or license plates, by code prefix. */
export function returnTargets(db: AppDb, scope: Scope, input: z.output<typeof targetQuerySchema>): StationOption[] {
  if (!hasWarehouse(scope, input.warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const like = `${(input.q ?? "").toLowerCase()}%`;
  if (input.kind === "lp") {
    return db.all<{ id: string; code: string; detail: string | null }>(sql`SELECT lp.id, lp.number AS code, l.code AS detail FROM license_plates lp
      LEFT JOIN locations l ON l.id = lp.location_id WHERE lp.warehouse_id = ${input.warehouseId} AND lower(lp.number) LIKE ${like}
      ORDER BY lp.number LIMIT 50`).map((r) => ({ ...r, kind: "lp" as const }));
  }
  return db.all<{ id: string; code: string; detail: string | null }>(sql`SELECT id, code, area_type || ' · ' || location_type AS detail FROM locations
    WHERE warehouse_id = ${input.warehouseId} AND is_active = 1 AND lower(code) LIKE ${like}
    ORDER BY CASE WHEN area_type = 'Returns' THEN 0 ELSE 1 END, code LIMIT 50`).map((r) => ({ ...r, kind: "location" as const }));
}
