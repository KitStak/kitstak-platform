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
import { runWorkflows } from "../workflows";
import { orderTypeFlags } from "../so-type-flags";
import { localDate } from "./common";
import { dbGet } from "@/server/db/sql";

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
export async function ensureOpenManifest(tx: Tx, ctx: DomainCtx, input: EnsureManifestInput): Promise<EodRow> {
  const m = schema.endOfDayManifests;
  const key = and(eq(m.warehouseId, input.warehouseId), eq(m.carrierConnectionId, input.carrierConnectionId), eq(m.shipDate, input.shipDate));
  const open = (await tx.select().from(m).where(and(key, eq(m.status, "Open"))).limit(1))[0];
  if (open) return open;
  const last = (await dbGet<{ n: number | null }>(tx, sql`SELECT MAX(sequence) AS n FROM end_of_day_manifests
    WHERE warehouse_id = ${input.warehouseId} AND carrier_connection_id = ${input.carrierConnectionId} AND ship_date = ${input.shipDate}`))?.n ?? 0;
  const conn = (await tx.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.id, input.carrierConnectionId)).limit(1))[0];
  const carrierCode = input.carrierCode
    ?? (await tx.select({ c: schema.shipments.carrierCode }).from(schema.shipments).where(eq(schema.shipments.carrierConnectionId, input.carrierConnectionId)).limit(1))[0]?.c
    ?? conn?.provider ?? "";
  return (await tx.insert(m).values({
    warehouseId: input.warehouseId, carrierConnectionId: input.carrierConnectionId, carrierPrefix: conn?.accountPrefix ?? "", carrierCode,
    shipDate: input.shipDate, sequence: Number(last) + 1, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
}

/** Links active shipping labels that have no manifest yet to their open manifest and counts them. */
export async function attachLabelsToManifest(tx: Tx, ctx: DomainCtx, shipments: readonly ShipmentRow[], at: Date): Promise<void> {
  const pending = shipments.filter((s) => s.carrierConnectionId && !s.endOfDayManifestId && s.labelType === "Shipping Label" && s.labelStatus !== "Voided");
  if (pending.length === 0) return;
  const tz = new Map<string, string>();
  const groups = new Map<string, { warehouseId: string; connectionId: string; shipDate: string; carrierCode: string; ids: string[] }>();
  for (const s of pending) {
    if (!tz.has(s.warehouseId)) tz.set(s.warehouseId, (await tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, s.warehouseId)).limit(1))[0]?.timezone ?? "UTC");
    const shipDate = localDate(at, tz.get(s.warehouseId) ?? "UTC");
    const key = `${s.warehouseId}|${s.carrierConnectionId}|${shipDate}`;
    const g = groups.get(key) ?? { warehouseId: s.warehouseId, connectionId: s.carrierConnectionId as string, shipDate, carrierCode: s.carrierCode, ids: [] };
    g.ids.push(s.id);
    groups.set(key, g);
  }
  const m = schema.endOfDayManifests;
  for (const g of groups.values()) {
    const manifest = await ensureOpenManifest(tx, ctx, { warehouseId: g.warehouseId, carrierConnectionId: g.connectionId, shipDate: g.shipDate, carrierCode: g.carrierCode });
    await tx.update(schema.shipments).set({ endOfDayManifestId: manifest.id }).where(inArray(schema.shipments.id, g.ids));
    await tx.update(m).set({ totalPackages: sql`${m.totalPackages} + ${g.ids.length}`, updatedBy: ctx.userId }).where(eq(m.id, manifest.id));
  }
}

/** Voided labels leave their (still Open) manifest and its package count. */
export async function detachVoidedFromManifest(tx: Tx, ctx: DomainCtx, shipments: readonly ShipmentRow[]): Promise<void> {
  const m = schema.endOfDayManifests;
  const byManifest = new Map<string, string[]>();
  for (const s of shipments) if (s.endOfDayManifestId) byManifest.set(s.endOfDayManifestId, [...(byManifest.get(s.endOfDayManifestId) ?? []), s.id]);
  for (const [manifestId, ids] of byManifest) {
    const manifest = (await tx.select().from(m).where(eq(m.id, manifestId)).limit(1))[0];
    if (!manifest || manifest.status !== "Open") continue;
    await tx.update(schema.shipments).set({ endOfDayManifestId: null }).where(inArray(schema.shipments.id, ids));
    const remaining = (await dbGet<{ n: number }>(tx, sql`SELECT COUNT(*) AS n FROM shipments WHERE end_of_day_manifest_id = ${manifestId}`))?.n ?? 0;
    // An Open manifest whose every label was voided has nothing to close: drop it (End Of The Day never lists empty manifests).
    if (Number(remaining) === 0) await tx.delete(m).where(and(eq(m.id, manifestId), eq(m.status, "Open")));
    else await tx.update(m).set({ totalPackages: sql`GREATEST(0, ${m.totalPackages} - ${ids.length})`, updatedBy: ctx.userId }).where(eq(m.id, manifestId));
  }
}

async function shipOne(tx: Tx, ctx: DomainCtx, orderId: string, input: ShipOrdersInput): Promise<void> {
  const order = (await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1))[0];
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  if (order.status !== "Ready to Ship") throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only Ready to Ship orders can be shipped.`);
  const labels = await tx.select().from(schema.shipments).where(and(
    eq(schema.shipments.orderId, order.id), eq(schema.shipments.labelType, "Shipping Label"), eq(schema.shipments.labelStatus, "Active"), isNull(schema.shipments.actualShipmentAt),
  ));
  // Shipment Order Type "Allow shipment without label": Ship Order never requires a carrier label for this type.
  const requireLabel = (input.requireLabel ?? true) && !(await orderTypeFlags(tx, order.orderTypeId)).has("allowShipWithoutLabel");
  if (requireLabel && labels.length === 0) throw new DomainError("INVALID_STATE", `Order ${order.code} has no active shipping label.`);
  if (labels.length === 0) {
    // "Ship without label" is for orders that never had one: a voided label means the parcel
    // was never handed to the carrier (db:verify shipped_without_label; orders REQ-R6-2).
    const voided = await tx.select({ id: schema.shipments.id }).from(schema.shipments).where(and(
      eq(schema.shipments.orderId, order.id), eq(schema.shipments.labelType, "Shipping Label"), eq(schema.shipments.labelStatus, "Voided"),
    ));
    if (voided.length > 0) {
      throw new DomainError("INVALID_STATE", `Order ${order.code} has no active shipping label (its label was voided). Create a new label before shipping.`);
    }
  }
  const allocs = await tx.select().from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.orderId, order.id), inArray(schema.inventoryAllocations.status, ["Packed", "Loaded"])));
  if (allocs.length === 0) throw new DomainError("INVALID_STATE", `Nothing is packed for order ${order.code}.`);
  const shipmentId = labels[0]?.id ?? null;
  const perLine = new Map<string, { qty: number; txnId: string }>();
  for (const a of allocs) {
    const { txn } = await consume(tx, ctx, { inventoryId: a.inventoryId, qty: a.qty, allocationId: a.id, type: "Shipment", refs: { shipmentId } });
    if (a.orderLineId && txn) perLine.set(a.orderLineId, { qty: (perLine.get(a.orderLineId)?.qty ?? 0) + a.qty, txnId: txn.id });
  }
  for (const [lineId, { qty, txnId }] of perLine) {
    await tx.update(schema.orderLines).set({ shippedQuantity: sql`${schema.orderLines.shippedQuantity} + ${qty}`, updatedBy: ctx.userId }).where(eq(schema.orderLines.id, lineId));
    await shipSerials(tx, ctx, { orderLineId: lineId, shipmentId, txnId });
  }
  const lines = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id));
  const complete = lines.every((l) => l.shippedQuantity >= l.quantity - l.cancelledQuantity);
  const status = stateMachines.shipmentOrder.transition(order.status, complete ? "Shipped" : "Partially Shipped");
  const at = input.shipDate ? new Date(input.shipDate) : new Date();
  if (Number.isNaN(at.getTime())) throw new DomainError("VALIDATION", "Invalid ship date");
  await tx.update(schema.shipmentOrders).set({ status, shippedAt: at.toISOString(), updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, order.id));
  await recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { status: order.status }, after: { status } });
  if (labels.length > 0) {
    await tx.update(schema.shipments).set({ actualShipmentAt: at.toISOString() }).where(inArray(schema.shipments.id, labels.map((l) => l.id)));
    // Labels are normally linked when they are created; this covers labels created before that.
    await attachLabelsToManifest(tx, ctx, labels, at);
  }
  // M12 "Order Shipped" workflows (Shipped and Partially Shipped; conditions can test Status).
  await runWorkflows(tx, ctx, "Order Shipped", { type: "shipment_order", id: order.id });
}

export async function shipOrders(tx: Tx, ctx: DomainCtx, input: ShipOrdersInput): Promise<BulkResult> {
  return await runBulk(tx, input.orderIds, async (inner, id) => await shipOne(inner, ctx, id, input));
}

export async function closeEndOfDay(tx: Tx, ctx: DomainCtx, input: { manifestId: string }): Promise<EodRow> {
  const m = schema.endOfDayManifests;
  const manifest = (await tx.select().from(m).where(eq(m.id, input.manifestId)).limit(1))[0];
  if (!manifest) throw new DomainError("NOT_FOUND", "End of day manifest not found");
  checkScope(ctx, { warehouseId: manifest.warehouseId }, "End of day manifest");
  const status = stateMachines.endOfDay.transition(manifest.status, "Closed");
  const updated = (await tx.update(m).set({ status, closeDate: new Date().toISOString(), updatedBy: ctx.userId }).where(eq(m.id, manifest.id)).returning())[0];
  await recordUpdate(tx, ctx, { entityType: "end_of_day_manifest", entityId: manifest.id, entityCode: manifest.shipDate, before: { status: manifest.status }, after: { status } });
  return updated;
}
