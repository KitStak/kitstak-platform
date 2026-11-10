/**
 * `shipOrders` consumes the packed / loaded stock through ledger Shipment transactions,
 * sets Shipped / Partially Shipped, upserts the end-of-day manifest and ships serials.
 * `closeEndOfDay` closes a manifest.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { runBulk } from "../bulk";
import { recordUpdate } from "../change-log";
import { DomainError } from "../errors";
import type { OrderRow } from "../facts";
import { consume } from "../ledger/operations";
import { shipSerials } from "../ledger/serials";
import { stateMachines } from "../state-machines";
import { checkScope, type BulkResult, type DomainCtx, type Tx } from "../types";
import { localDate } from "./common";

type ShipmentRow = typeof schema.shipments.$inferSelect;
export type EodRow = typeof schema.endOfDayManifests.$inferSelect;

export interface ShipOrdersInput {
  readonly orderIds: readonly string[];
  /** ISO instant; defaults to now. */
  readonly shipDate?: string;
  /** Default true: an order needs an active shipping label. */
  readonly requireLabel?: boolean;
}

export interface EnsureManifestInput {
  readonly warehouseId: string;
  readonly carrierConnectionId: string;
  /** Warehouse-local YYYY-MM-DD. */
  readonly shipDate: string;
  readonly carrierCode?: string;
}

/**
 * Open end-of-day manifest for (warehouse, carrier connection, day), created when missing.
 * After a manifest is closed the next label opens a new one with `sequence + 1`
 * (docs/requests/shipping.md REQ-1, REQ-2).
 */
export function ensureOpenManifest(tx: Tx, ctx: DomainCtx, input: EnsureManifestInput): EodRow {
  const m = schema.endOfDayManifests;
  const key = and(eq(m.warehouseId, input.warehouseId), eq(m.carrierConnectionId, input.carrierConnectionId), eq(m.shipDate, input.shipDate));
  const open = tx.select().from(m).where(and(key, eq(m.status, "Open"))).get();
  if (open) return open;
  const last = tx.get<{ n: number | null }>(sql`SELECT MAX(sequence) AS n FROM end_of_day_manifests
    WHERE warehouse_id = ${input.warehouseId} AND carrier_connection_id = ${input.carrierConnectionId} AND ship_date = ${input.shipDate}`)?.n ?? 0;
  const conn = tx.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, input.carrierConnectionId)).get();
  const carrierCode = input.carrierCode
    ?? tx.select({ c: schema.shipments.carrierCode }).from(schema.shipments).where(eq(schema.shipments.carrierConnectionId, input.carrierConnectionId)).get()?.c
    ?? conn?.provider ?? "";
  return tx.insert(m).values({
    warehouseId: input.warehouseId, carrierConnectionId: input.carrierConnectionId, carrierPrefix: conn?.accountPrefix ?? "", carrierCode,
    shipDate: input.shipDate, sequence: Number(last) + 1, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
}

/** Links active shipping labels that have no manifest yet to their open manifest and counts them. */
export function attachLabelsToManifest(tx: Tx, ctx: DomainCtx, shipments: readonly ShipmentRow[], at: Date): void {
  const pending = shipments.filter((s) => s.carrierConnectionId && !s.endOfDayManifestId && s.labelType === "Shipping Label" && s.labelStatus !== "Voided");
  if (pending.length === 0) return;
  const tz = new Map<string, string>();
  const groups = new Map<string, { warehouseId: string; connectionId: string; shipDate: string; carrierCode: string; ids: string[] }>();
  for (const s of pending) {
    if (!tz.has(s.warehouseId)) tz.set(s.warehouseId, tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, s.warehouseId)).get()?.timezone ?? "UTC");
    const shipDate = localDate(at, tz.get(s.warehouseId) ?? "UTC");
    const key = `${s.warehouseId}|${s.carrierConnectionId}|${shipDate}`;
    const g = groups.get(key) ?? { warehouseId: s.warehouseId, connectionId: s.carrierConnectionId as string, shipDate, carrierCode: s.carrierCode, ids: [] };
    g.ids.push(s.id);
    groups.set(key, g);
  }
  const m = schema.endOfDayManifests;
  for (const g of groups.values()) {
    const manifest = ensureOpenManifest(tx, ctx, { warehouseId: g.warehouseId, carrierConnectionId: g.connectionId, shipDate: g.shipDate, carrierCode: g.carrierCode });
    tx.update(schema.shipments).set({ endOfDayManifestId: manifest.id }).where(inArray(schema.shipments.id, g.ids)).run();
    tx.update(m).set({ totalPackages: sql`${m.totalPackages} + ${g.ids.length}`, updatedBy: ctx.userId }).where(eq(m.id, manifest.id)).run();
  }
}

/** Voided labels leave their (still Open) manifest and its package count. */
export function detachVoidedFromManifest(tx: Tx, ctx: DomainCtx, shipments: readonly ShipmentRow[]): void {
  const m = schema.endOfDayManifests;
  const byManifest = new Map<string, string[]>();
  for (const s of shipments) if (s.endOfDayManifestId) byManifest.set(s.endOfDayManifestId, [...(byManifest.get(s.endOfDayManifestId) ?? []), s.id]);
  for (const [manifestId, ids] of byManifest) {
    const manifest = tx.select().from(m).where(eq(m.id, manifestId)).get();
    if (!manifest || manifest.status !== "Open") continue;
    tx.update(schema.shipments).set({ endOfDayManifestId: null }).where(inArray(schema.shipments.id, ids)).run();
    tx.update(m).set({ totalPackages: sql`MAX(0, ${m.totalPackages} - ${ids.length})`, updatedBy: ctx.userId }).where(eq(m.id, manifestId)).run();
  }
}

function shipOne(tx: Tx, ctx: DomainCtx, orderId: string, input: ShipOrdersInput): void {
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  if (order.status !== "Ready to Ship") throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only Ready to Ship orders can be shipped.`);
  const labels = tx.select().from(schema.shipments).where(and(
    eq(schema.shipments.orderId, order.id), eq(schema.shipments.labelType, "Shipping Label"), eq(schema.shipments.labelStatus, "Active"), isNull(schema.shipments.actualShipmentAt),
  )).all();
  if ((input.requireLabel ?? true) && labels.length === 0) throw new DomainError("INVALID_STATE", `Order ${order.code} has no active shipping label.`);
  const allocs = tx.select().from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.orderId, order.id), inArray(schema.inventoryAllocations.status, ["Packed", "Loaded"]))).all();
  if (allocs.length === 0) throw new DomainError("INVALID_STATE", `Nothing is packed for order ${order.code}.`);
  const shipmentId = labels[0]?.id ?? null;
  const perLine = new Map<string, { qty: number; txnId: string }>();
  for (const a of allocs) {
    const { txn } = consume(tx, ctx, { inventoryId: a.inventoryId, qty: a.qty, allocationId: a.id, type: "Shipment", refs: { shipmentId } });
    if (a.orderLineId && txn) perLine.set(a.orderLineId, { qty: (perLine.get(a.orderLineId)?.qty ?? 0) + a.qty, txnId: txn.id });
  }
  for (const [lineId, { qty, txnId }] of perLine) {
    tx.update(schema.orderLines).set({ shippedQuantity: sql`${schema.orderLines.shippedQuantity} + ${qty}`, updatedBy: ctx.userId }).where(eq(schema.orderLines.id, lineId)).run();
    shipSerials(tx, ctx, { orderLineId: lineId, shipmentId, txnId });
  }
  const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all();
  const complete = lines.every((l) => l.shippedQuantity >= l.quantity - l.cancelledQuantity);
  const status = stateMachines.shipmentOrder.transition(order.status, complete ? "Shipped" : "Partially Shipped");
  const at = input.shipDate ? new Date(input.shipDate) : new Date();
  if (Number.isNaN(at.getTime())) throw new DomainError("VALIDATION", "Invalid ship date");
  tx.update(schema.shipmentOrders).set({ status, shippedAt: at.toISOString(), updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, order.id)).run();
  recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { status: order.status }, after: { status } });
  if (labels.length > 0) {
    tx.update(schema.shipments).set({ actualShipmentAt: at.toISOString() }).where(inArray(schema.shipments.id, labels.map((l) => l.id))).run();
    // Labels are normally linked when they are created; this covers labels created before that.
    attachLabelsToManifest(tx, ctx, labels, at);
  }
}

export function shipOrders(tx: Tx, ctx: DomainCtx, input: ShipOrdersInput): BulkResult {
  return runBulk(tx, input.orderIds, (inner, id) => shipOne(inner, ctx, id, input));
}

export function closeEndOfDay(tx: Tx, ctx: DomainCtx, input: { manifestId: string }): EodRow {
  const m = schema.endOfDayManifests;
  const manifest = tx.select().from(m).where(eq(m.id, input.manifestId)).get();
  if (!manifest) throw new DomainError("NOT_FOUND", "End of day manifest not found");
  checkScope(ctx, { warehouseId: manifest.warehouseId }, "End of day manifest");
  const status = stateMachines.endOfDay.transition(manifest.status, "Closed");
  const updated = tx.update(m).set({ status, closeDate: new Date().toISOString(), updatedBy: ctx.userId }).where(eq(m.id, manifest.id)).returning().get();
  recordUpdate(tx, ctx, { entityType: "end_of_day_manifest", entityId: manifest.id, entityCode: manifest.shipDate, before: { status: manifest.status }, after: { status } });
  return updated;
}
