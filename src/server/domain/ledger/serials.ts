/** Serial numbers: register on receipt, pick, ship (BUILD_PLAN F5 ledger "Serials"). */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { InventoryStatus, TxnType } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { recordLine } from "../change-log";
import { DomainError } from "../errors";
import { checkScope, type DomainCtx, type Tx } from "../types";

export type SerialRow = typeof schema.serialNumbers.$inferSelect;
type SerialStatus = SerialRow["status"];

function logSerial(tx: Tx, serialId: string, txnId: string, type: TxnType, status: SerialStatus): void {
  tx.insert(schema.serialTransactions).values({ serialId, inventoryTransactionId: txnId, type, status }).run();
}

export interface RegisterSerialsInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly serials: readonly { readonly primary: string; readonly secondary?: string | null }[];
  readonly inventoryId: string;
  readonly receiptId?: string | null;
  readonly txnId: string;
  readonly type?: TxnType;
}

export function registerSerials(tx: Tx, ctx: DomainCtx, input: RegisterSerialsInput): SerialRow[] {
  const primaries = input.serials.map((s) => s.primary.trim());
  if (primaries.some((p) => p.length === 0)) throw new DomainError("VALIDATION", "Serial numbers can't be empty");
  const dupInInput = primaries.find((p, i) => primaries.indexOf(p) !== i);
  if (dupInInput) throw new DomainError("DUPLICATE", `Serial number ${dupInInput} is entered more than once.`);
  if (primaries.length === 0) return [];
  const existing = tx.select().from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.productId, input.productId), inArray(schema.serialNumbers.primarySerial, primaries))).all();
  const reusable = new Map(existing.filter((s) => s.status === "Shipped" || s.status === "Receipt Cancelled").map((s) => [s.primarySerial, s]));
  const live = existing.find((s) => !reusable.has(s.primarySerial));
  if (live) throw new DomainError("DUPLICATE", `Serial number ${live.primarySerial} is already in stock.`);
  return input.serials.map((s) => {
    const primary = s.primary.trim();
    const values = {
      productId: input.productId, warehouseId: input.warehouseId, clientId: input.clientId, primarySerial: primary,
      secondarySerial: s.secondary ?? null, status: "Received" as const, inventoryId: input.inventoryId,
      receiptId: input.receiptId ?? null, orderLineId: null, shipmentId: null, updatedBy: ctx.userId,
    };
    const prior = reusable.get(primary);
    const row = prior
      ? tx.update(schema.serialNumbers).set(values).where(eq(schema.serialNumbers.id, prior.id)).returning().get()
      : tx.insert(schema.serialNumbers).values({ ...values, createdBy: ctx.userId }).returning().get();
    logSerial(tx, row.id, input.txnId, input.type ?? "Receiving", "Received");
    return row;
  });
}

export function pickSerial(
  tx: Tx, ctx: DomainCtx,
  input: { productId: string; serial: string; orderLineId: string; fromInventoryId: string; toInventoryId: string; txnId: string },
): SerialRow {
  const row = tx.select().from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.productId, input.productId), eq(schema.serialNumbers.primarySerial, input.serial))).get();
  if (!row) throw new DomainError("NOT_FOUND", `Serial number ${input.serial} not found`);
  if (row.status !== "Received" && row.status !== "Updated") throw new DomainError("INVALID_STATE", `Serial number ${input.serial} is ${row.status.toLowerCase()}.`);
  if (row.inventoryId !== input.fromInventoryId) throw new DomainError("RULE_VIOLATION", `Serial number ${input.serial} is not in the picked location.`);
  const updated = tx.update(schema.serialNumbers)
    .set({ status: "Picked", orderLineId: input.orderLineId, inventoryId: input.toInventoryId, updatedBy: ctx.userId })
    .where(eq(schema.serialNumbers.id, row.id)).returning().get();
  logSerial(tx, row.id, input.txnId, "Picking", "Picked");
  return updated;
}

/** Marks every picked serial of an order line shipped. Returns the count. */
export function shipSerials(tx: Tx, ctx: DomainCtx, input: { orderLineId: string; shipmentId: string | null; txnId: string }): number {
  const rows = tx.select().from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.orderLineId, input.orderLineId), eq(schema.serialNumbers.status, "Picked"))).all();
  for (const row of rows) {
    tx.update(schema.serialNumbers).set({ status: "Shipped", shipmentId: input.shipmentId, inventoryId: null, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, row.id)).run();
    logSerial(tx, row.id, input.txnId, "Shipment", "Shipped");
  }
  return rows.length;
}

export function cancelReceiptSerials(tx: Tx, ctx: DomainCtx, receiptId: string, txnId: string): number {
  const rows = tx.select().from(schema.serialNumbers).where(eq(schema.serialNumbers.receiptId, receiptId)).all();
  const inStock = rows.filter((r) => r.status === "Received" || r.status === "Updated");
  if (inStock.length !== rows.length) throw new DomainError("INVALID_STATE", "Some serial numbers of this receipt were already picked or shipped.");
  for (const row of inStock) {
    tx.update(schema.serialNumbers).set({ status: "Receipt Cancelled", inventoryId: null, updatedBy: ctx.userId }).where(eq(schema.serialNumbers.id, row.id)).run();
    logSerial(tx, row.id, txnId, "Cancel Receiving", "Receipt Cancelled");
  }
  return inStock.length;
}

/* ------------------------------------------------- serials follow the ledger */
const ON_HAND_SERIAL: readonly SerialStatus[] = ["Received", "Updated", "Picked"];

function isSerialTracked(tx: Tx, productId: string): boolean {
  return tx.select({ trackSerial: schema.products.trackSerial }).from(schema.products).where(eq(schema.products.id, productId)).get()?.trackSerial === true;
}

export interface CarrySerialsInput {
  readonly productId: string;
  readonly fromInventoryId: string;
  readonly toInventoryId: string;
  /** Units moved by the ledger. */
  readonly qty: number;
  /** Source bucket on-hand after the move. */
  readonly sourceOnHand: number;
  readonly toStatus: InventoryStatus;
  readonly orderLineId?: string | null;
  readonly txnId: string;
  readonly type: TxnType;
}

/**
 * Keeps serial rows with their units when the ledger moves stock without scanned serials
 * (web picks, transfers, putaway, status changes). Only the serials the source can no longer
 * hold move, so it is a no-op when the caller already moved scanned serials with `pickSerial`.
 * Serials pre-assigned to the order line move first, then oldest first. Returns the count moved.
 */
export function carrySerials(tx: Tx, ctx: DomainCtx, input: CarrySerialsInput): number {
  if (!isSerialTracked(tx, input.productId)) return 0;
  const inSource = tx.select().from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.inventoryId, input.fromInventoryId), inArray(schema.serialNumbers.status, [...ON_HAND_SERIAL]))).all();
  const count = Math.min(input.qty, Math.max(0, inSource.length - input.sourceOnHand));
  if (count === 0) return 0;
  const line = input.orderLineId ?? null;
  const ordered = [...inSource].sort((a, b) => {
    const aLine = line !== null && a.orderLineId === line ? 0 : 1;
    const bLine = line !== null && b.orderLineId === line ? 0 : 1;
    return aLine - bLine || a.entryAt.localeCompare(b.entryAt) || a.primarySerial.localeCompare(b.primarySerial);
  });
  const toStock = input.toStatus === "Stock";
  for (const row of ordered.slice(0, count)) {
    const status: SerialStatus = toStock ? (row.status === "Picked" ? "Received" : row.status) : line ? "Picked" : row.status;
    tx.update(schema.serialNumbers)
      .set({ inventoryId: input.toInventoryId, status, orderLineId: !toStock && line ? line : row.orderLineId, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, row.id)).run();
    logSerial(tx, row.id, input.txnId, input.type, status);
  }
  return count;
}

export interface RestockReturnedSerialsInput {
  readonly orderLineId: string;
  readonly productId: string;
  readonly inventoryId: string;
  readonly qty: number;
  readonly txnId: string;
}

/**
 * A return restocked without scanned serials puts back serials that shipped on the original
 * order line (oldest first), so the restocked bucket keeps one serial per unit. Returns the count.
 */
export function restockReturnedSerials(tx: Tx, ctx: DomainCtx, input: RestockReturnedSerialsInput): number {
  if (!isSerialTracked(tx, input.productId)) return 0;
  const shipped = tx.select().from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.orderLineId, input.orderLineId), eq(schema.serialNumbers.productId, input.productId), eq(schema.serialNumbers.status, "Shipped")))
    .all()
    .sort((a, b) => a.entryAt.localeCompare(b.entryAt) || a.primarySerial.localeCompare(b.primarySerial))
    .slice(0, input.qty);
  for (const row of shipped) {
    tx.update(schema.serialNumbers)
      .set({ status: "Received", inventoryId: input.inventoryId, orderLineId: null, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, row.id)).run();
    logSerial(tx, row.id, input.txnId, "Return Receiving", "Received");
  }
  return shipped.length;
}

/* ---------------------------------------------- order-line serial assignment */
const ASSIGNABLE: ReadonlySet<SerialRow["status"]> = new Set(["Received", "Updated"]);

/**
 * Pre-assigns a registered serial to a shipment-order line (SO serials import;
 * docs/requests/orders-outbound.md REQ-3). No stock moves, so no serial transaction is written;
 * the link is logged on the order. Idempotent for the same line.
 */
export function assignOrderSerial(tx: Tx, ctx: DomainCtx, input: { orderLineId: string; serial: string }): SerialRow {
  const serial = input.serial.trim();
  if (!serial) throw new DomainError("VALIDATION", "Serial number is required");
  const line = tx.select().from(schema.orderLines).where(eq(schema.orderLines.id, input.orderLineId)).get();
  if (!line) throw new DomainError("NOT_FOUND", "Order line not found");
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, line.orderId)).get();
  if (!order) throw new DomainError("NOT_FOUND", "Shipment order not found");
  if (ctx.scope) checkScope(ctx, order, "Shipment order");
  const sn = tx.select().from(schema.serialNumbers).where(and(eq(schema.serialNumbers.productId, line.productId), eq(schema.serialNumbers.primarySerial, serial))).get();
  if (!sn) throw new DomainError("NOT_FOUND", `Serial ${serial} is not registered for this product`);
  if (sn.orderLineId === line.id) return sn;
  if (sn.orderLineId) throw new DomainError("DUPLICATE", `Serial ${serial} is already assigned to another order`);
  if (sn.shipmentId || !ASSIGNABLE.has(sn.status)) throw new DomainError("INVALID_STATE", `Serial ${serial} is ${sn.status.toLowerCase()} and can't be assigned`);
  if (sn.warehouseId !== order.warehouseId) throw new DomainError("VALIDATION", `Serial ${serial} is in another warehouse`);
  const assigned = tx.select({ id: schema.serialNumbers.id }).from(schema.serialNumbers).where(eq(schema.serialNumbers.orderLineId, line.id)).all().length;
  if (assigned >= line.quantity - line.cancelledQuantity) throw new DomainError("RULE_VIOLATION", "This line already has a serial number for every unit");
  const row = tx.update(schema.serialNumbers).set({ orderLineId: line.id, updatedBy: ctx.userId }).where(eq(schema.serialNumbers.id, sn.id)).returning().get();
  const product = tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, line.productId)).get();
  recordLine(tx, ctx, {
    entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id,
    lineLabel: product?.sku ?? "Line", field: "serialNumbers", from: "", to: serial,
  });
  return row;
}

/** Detaches every not-yet-picked serial from an order line (Delete ▾ Remove Serial Number). Returns the count. */
export function unassignOrderSerials(tx: Tx, ctx: DomainCtx, input: { orderLineId: string }): number {
  const line = tx.select().from(schema.orderLines).where(eq(schema.orderLines.id, input.orderLineId)).get();
  if (!line) throw new DomainError("NOT_FOUND", "Order line not found");
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, line.orderId)).get();
  if (!order) throw new DomainError("NOT_FOUND", "Shipment order not found");
  if (ctx.scope) checkScope(ctx, order, "Shipment order");
  const rows = tx.select().from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.orderLineId, line.id), isNull(schema.serialNumbers.shipmentId), inArray(schema.serialNumbers.status, [...ASSIGNABLE]))).all();
  if (rows.length === 0) return 0;
  tx.update(schema.serialNumbers).set({ orderLineId: null, updatedBy: ctx.userId }).where(inArray(schema.serialNumbers.id, rows.map((r) => r.id))).run();
  const product = tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, line.productId)).get();
  recordLine(tx, ctx, {
    entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line", lineEntityId: line.id,
    lineLabel: product?.sku ?? "Line", field: "serialNumbers", from: rows.map((r) => r.primarySerial).join(", "), to: "",
  });
  return rows.length;
}
