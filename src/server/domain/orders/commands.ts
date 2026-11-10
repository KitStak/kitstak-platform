/**
 * Shipment-order status commands: cancel (reason required; deallocates), hold, release,
 * change warehouse, backorder, soft delete, unmerge. Bulk commands return per-id results.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { SoStatus } from "@/lib/enums";
import { isOneOf, SO_STATUSES } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { deallocateOrder } from "../allocation";
import { runBulk } from "../bulk";
import { lastFromValue, recordCreate, recordDelete, recordUpdate } from "../change-log";
import { DomainError } from "../errors";
import type { OrderRow } from "../facts";
import { stateMachines } from "../state-machines";
import { nowIso, type BulkResult, type DomainCtx, type Tx } from "../types";
import { loadOrderRow } from "./create-update";

function setStatus(tx: Tx, ctx: DomainCtx, order: OrderRow, status: SoStatus, extra: Partial<typeof schema.shipmentOrders.$inferInsert> = {}): OrderRow {
  const after = tx.update(schema.shipmentOrders).set({ ...extra, status, updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, order.id)).returning().get();
  recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { status: order.status, ...pick(order, extra) }, after: { status, ...pick(after, extra) } });
  return after;
}

function pick(row: OrderRow, keys: object): Record<string, unknown> {
  return Object.fromEntries(Object.keys(keys).filter((k) => k !== "updatedBy").map((k) => [k, row[k as keyof OrderRow]]));
}

function assertNoJob(order: OrderRow, action: string): void {
  if (order.jobId) throw new DomainError("INVALID_STATE", `Order ${order.code} is in a job. Remove it from the job before you ${action} it.`);
}

export function cancelOrders(tx: Tx, ctx: DomainCtx, input: { ids: readonly string[]; reasonId: string; note?: string | null }): BulkResult {
  if (!input.reasonId) throw new DomainError("VALIDATION", "A cancel reason is required");
  return runBulk(tx, input.ids, (inner, id) => {
    const order = loadOrderRow(inner, ctx, id);
    stateMachines.shipmentOrder.transition(order.status, "Cancelled", { reason: input.reasonId });
    assertNoJob(order, "cancel");
    deallocateOrder(inner, ctx, order);
    const fresh = loadOrderRow(inner, ctx, id);
    inner.update(schema.orderLines).set({ cancelledQuantity: sql`${schema.orderLines.quantity} - ${schema.orderLines.shippedQuantity}`, updatedBy: ctx.userId })
      .where(eq(schema.orderLines.orderId, id)).run();
    setStatus(inner, ctx, fresh, stateMachines.shipmentOrder.transition(fresh.status, "Cancelled", { reason: input.reasonId }), {
      // The cancel note is not written into the order's own Note (orders REQ-R3-2): callers log it as a change-log entry / order note.
      cancelReasonId: input.reasonId, cancelledAt: nowIso(),
    });
  });
}

export function holdOrders(tx: Tx, ctx: DomainCtx, input: { ids: readonly string[] }): BulkResult {
  return runBulk(tx, input.ids, (inner, id) => {
    const order = loadOrderRow(inner, ctx, id);
    setStatus(inner, ctx, order, stateMachines.shipmentOrder.transition(order.status, "On Hold"));
  });
}

/** Returns held orders to the status they had before the hold. */
export function releaseOrders(tx: Tx, ctx: DomainCtx, input: { ids: readonly string[] }): BulkResult {
  return runBulk(tx, input.ids, (inner, id) => {
    const order = loadOrderRow(inner, ctx, id);
    if (order.status !== "On Hold") throw new DomainError("INVALID_STATE", `Order ${order.code} is not on hold.`);
    const previous = lastFromValue(inner, "shipment_order", id, "status", "On Hold");
    const target: SoStatus = previous && isOneOf(SO_STATUSES, previous) ? previous : "Open";
    setStatus(inner, ctx, order, stateMachines.shipmentOrder.transition(order.status, target, { previousStatus: target }));
  });
}

export function changeWarehouse(tx: Tx, ctx: DomainCtx, input: { ids: readonly string[]; warehouseId: string }): BulkResult {
  const wh = tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, input.warehouseId)).get();
  if (!wh || !wh.isActive) throw new DomainError("VALIDATION", "Warehouse not found or inactive");
  if (ctx.scope && !ctx.scope.warehouseIds.includes(wh.id)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  return runBulk(tx, input.ids, (inner, id) => {
    const order = loadOrderRow(inner, ctx, id);
    if (order.warehouseId === wh.id) throw new DomainError("VALIDATION", `Order ${order.code} is already in warehouse ${wh.code}.`);
    assertNoJob(order, "move");
    if (!["Open", "Shortage", "On Hold"].includes(order.status)) {
      throw new DomainError("INVALID_STATE", `Only Open, Shortage or On Hold orders can change warehouse; ${order.code} is ${order.status}.`);
    }
    const allocated = inner.select({ n: sql<number>`COALESCE(SUM(${schema.orderLines.allocatedQuantity}), 0)` }).from(schema.orderLines).where(eq(schema.orderLines.orderId, id)).get()?.n ?? 0;
    if (Number(allocated) > 0) deallocateOrder(inner, ctx, order);
    const fresh = loadOrderRow(inner, ctx, id);
    const after = inner.update(schema.shipmentOrders).set({ warehouseId: wh.id, updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
      .where(eq(schema.shipmentOrders.id, id)).returning().get();
    recordUpdate(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, before: { warehouseId: fresh.warehouseId }, after: { warehouseId: after.warehouseId } });
  });
}

/**
 * Splits the unallocated quantity of a Shortage order into a child back order
 * (`masterOrderId` = parent). The parent keeps what is allocated and becomes Ready to Pick.
 */
export function createBackorder(tx: Tx, ctx: DomainCtx, input: { orderId: string }): OrderRow {
  const parent = loadOrderRow(tx, ctx, input.orderId);
  if (parent.status !== "Shortage") throw new DomainError("INVALID_STATE", `Only Shortage orders can be back-ordered; ${parent.code} is ${parent.status}.`);
  const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, parent.id)).all();
  const remainder = lines.map((l) => ({ line: l, qty: l.quantity - l.cancelledQuantity - l.allocatedQuantity })).filter((x) => x.qty > 0);
  if (remainder.length === 0) throw new DomainError("INVALID_STATE", `Order ${parent.code} has no unallocated quantity.`);
  if (lines.every((l) => l.allocatedQuantity === 0)) throw new DomainError("INVALID_STATE", "Nothing is allocated; the whole order would move to the back order. Allocate stock first.");
  const n = tx.select({ n: sql<number>`COUNT(*)` }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.masterOrderId, parent.id)).get()?.n ?? 0;
  const now = nowIso();
  const child = tx.insert(schema.shipmentOrders).values({
    ...parent, id: crypto.randomUUID(), createdAt: now, updatedAt: now, version: 1, code: `${parent.code}-BO${Number(n) + 1}`, status: "Open", isBackOrder: true, masterOrderId: parent.id, jobId: null,
    trackingNumber: null, trackingNumbers: null, pickShortStatus: "None", packShortStatus: "None", createdBy: ctx.userId, updatedBy: ctx.userId,
    totalQuantity: remainder.reduce((s, r) => s + r.qty, 0),
  }).returning().get();
  for (const { line, qty } of remainder) {
    tx.insert(schema.orderLines).values({
      orderId: child.id, productId: line.productId, quantity: qty, unitPrice: line.unitPrice, packType: line.packType, uomRatio: line.uomRatio,
      lotNumber: line.lotNumber, expiryDate: line.expiryDate, productionDate: line.productionDate, damageReason: line.damageReason,
      lineNote1: line.lineNote1, lineNote2: line.lineNote2, lineNote3: line.lineNote3, originalOrderCode: parent.code, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).run();
    if (line.allocatedQuantity === 0) {
      tx.delete(schema.orderLineShortages).where(eq(schema.orderLineShortages.orderLineId, line.id)).run();
      tx.delete(schema.orderLines).where(eq(schema.orderLines.id, line.id)).run();
    } else {
      tx.update(schema.orderLines).set({ quantity: line.allocatedQuantity + line.cancelledQuantity, updatedBy: ctx.userId }).where(eq(schema.orderLines.id, line.id)).run();
    }
  }
  tx.update(schema.orderLineShortages).set({ resolvedAt: nowIso() }).where(and(eq(schema.orderLineShortages.orderId, parent.id), isNull(schema.orderLineShortages.resolvedAt))).run();
  setStatus(tx, ctx, parent, stateMachines.shipmentOrder.transition(parent.status, "Ready to Pick"), { totalQuantity: parent.totalQuantity - child.totalQuantity });
  recordCreate(tx, ctx, { entityType: "shipment_order", entityId: child.id, entityCode: child.code });
  return child;
}

/** Soft delete: Open orders without jobs or allocations only. */
export function deleteOrders(tx: Tx, ctx: DomainCtx, input: { ids: readonly string[] }): BulkResult {
  return runBulk(tx, input.ids, (inner, id) => {
    const order = loadOrderRow(inner, ctx, id);
    if (order.status !== "Open") throw new DomainError("INVALID_STATE", `Only Open orders can be deleted; ${order.code} is ${order.status}.`);
    assertNoJob(order, "delete");
    inner.update(schema.shipmentOrders).set({ deletedAt: nowIso(), updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, id)).run();
    recordDelete(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code });
  });
}

/**
 * Merges Open orders into a master (M03 Order Merge waves; inverse of `unmergeOrder`):
 * child lines are copied onto the master with `originalOrderCode` = child code, children go
 * On Hold with `mergedIntoOrderId` = master, the master gets `isMerged` and recomputed totals.
 * Every order must be Open, unmerged, outside a job, and share the master's warehouse and client.
 */
export function mergeOrders(tx: Tx, ctx: DomainCtx, input: { masterOrderId: string; childOrderIds: readonly string[] }): { merged: readonly string[] } {
  const master = loadOrderRow(tx, ctx, input.masterOrderId);
  const childIds = [...new Set(input.childOrderIds)].filter((id) => id !== master.id);
  if (childIds.length === 0) throw new DomainError("VALIDATION", "Choose at least one order to merge into the master.");
  if (master.status !== "Open") throw new DomainError("INVALID_STATE", `Only Open orders can be merged; ${master.code} is ${master.status}.`);
  if (master.mergedIntoOrderId) throw new DomainError("INVALID_STATE", `Order ${master.code} is already merged into another order.`);
  assertNoJob(master, "merge");
  const children = childIds.map((id) => loadOrderRow(tx, ctx, id));
  for (const child of children) {
    if (child.status !== "Open") throw new DomainError("INVALID_STATE", `Only Open orders can be merged; ${child.code} is ${child.status}.`);
    if (child.isMerged || child.mergedIntoOrderId) throw new DomainError("INVALID_STATE", `Order ${child.code} is already part of a merge.`);
    if (child.warehouseId !== master.warehouseId || child.clientId !== master.clientId) {
      throw new DomainError("VALIDATION", `Order ${child.code} belongs to another warehouse or client than ${master.code}.`);
    }
    assertNoJob(child, "merge");
  }
  for (const child of children) {
    const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, child.id)).all();
    for (const line of lines) {
      const qty = line.quantity - line.cancelledQuantity;
      if (qty <= 0) continue;
      tx.insert(schema.orderLines).values({
        orderId: master.id, productId: line.productId, quantity: qty, unitPrice: line.unitPrice,
        packType: line.packType, uomRatio: line.uomRatio, lotNumber: line.lotNumber, expiryDate: line.expiryDate,
        originalOrderCode: child.code, createdBy: ctx.userId, updatedBy: ctx.userId,
      }).run();
    }
    const held = stateMachines.shipmentOrder.transition(child.status, "On Hold");
    tx.update(schema.shipmentOrders).set({ status: held, mergedIntoOrderId: master.id, updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
      .where(eq(schema.shipmentOrders.id, child.id)).run();
    recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: child.id, entityCode: child.code, before: { status: child.status, mergedIntoOrderId: null }, after: { status: held, mergedIntoOrderId: master.code } });
  }
  const units = tx.get<{ q: number }>(sql`SELECT COALESCE(SUM(quantity - cancelled_quantity), 0) AS q FROM order_lines WHERE order_id = ${master.id}`)?.q ?? 0;
  tx.update(schema.shipmentOrders).set({ isMerged: true, totalQuantity: Number(units), updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, master.id)).run();
  recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: master.id, entityCode: master.code, before: { isMerged: master.isMerged, totalQuantity: master.totalQuantity }, after: { isMerged: true, totalQuantity: Number(units) } });
  return { merged: children.map((c) => c.id) };
}

/**
 * Undoes an order merge. Merge contract (M03 Order Merge waves): merged children are put
 * On Hold with `mergedIntoOrderId` = master, and master lines copied from a child carry
 * `originalOrderCode` = child code. Unmerge removes those master lines and releases the
 * children; a master left without lines is soft-deleted.
 */
export function unmergeOrder(tx: Tx, ctx: DomainCtx, input: { orderId: string }): { restored: readonly string[] } {
  const master = loadOrderRow(tx, ctx, input.orderId);
  if (!master.isMerged) throw new DomainError("INVALID_STATE", `Order ${master.code} is not a merged order.`);
  if (!["Open", "Shortage", "On Hold"].includes(master.status)) throw new DomainError("INVALID_STATE", `Order ${master.code} is ${master.status} and can't be unmerged.`);
  assertNoJob(master, "unmerge");
  deallocateOrder(tx, ctx, master);
  const children = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.mergedIntoOrderId, master.id)).all();
  for (const child of children) {
    const childLines = tx.select({ id: schema.orderLines.id }).from(schema.orderLines)
      .where(and(eq(schema.orderLines.orderId, master.id), eq(schema.orderLines.originalOrderCode, child.code))).all();
    for (const l of childLines) {
      tx.delete(schema.orderLineShortages).where(eq(schema.orderLineShortages.orderLineId, l.id)).run();
      tx.delete(schema.orderLines).where(eq(schema.orderLines.id, l.id)).run();
    }
    const released = child.status === "On Hold" ? stateMachines.shipmentOrder.transition(child.status, "Open", { previousStatus: "Open" }) : child.status;
    setStatus(tx, ctx, child, released, { mergedIntoOrderId: null });
  }
  const left = tx.select({ n: sql<number>`COUNT(*)` }).from(schema.orderLines).where(eq(schema.orderLines.orderId, master.id)).get()?.n ?? 0;
  const fresh = loadOrderRow(tx, ctx, master.id);
  tx.update(schema.shipmentOrders).set({ isMerged: false, ...(Number(left) === 0 ? { deletedAt: nowIso() } : {}), updatedBy: ctx.userId })
    .where(eq(schema.shipmentOrders.id, master.id)).run();
  if (Number(left) === 0) recordDelete(tx, ctx, { entityType: "shipment_order", entityId: master.id, entityCode: master.code });
  else recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: master.id, entityCode: master.code, before: { isMerged: fresh.isMerged }, after: { isMerged: false } });
  return { restored: children.map((c) => c.id) };
}
