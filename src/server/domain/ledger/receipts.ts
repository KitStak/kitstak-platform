/**
 * Receipts (Receiving History rows): `recordReceipt` / `cancelReceipt`. Each receipt
 * posts a Receiving / Return Receiving transaction and keeps PO / return lines in sync.
 */
import { eq, sql } from "drizzle-orm";
import type { RECEIVING_TYPES, TxnType } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { recordLine } from "../change-log";
import { DomainError } from "../errors";
import { nextInteger } from "../sequences";
import { stateMachines } from "../state-machines";
import { checkScope, nowIso, type DomainCtx, type Tx } from "../types";
import { getBucket, packRatio } from "./bucket";
import { add, remove } from "./operations";
import { cancelReceiptSerials, registerSerials, restockReturnedSerials } from "./serials";
import type { TxnRow } from "./txn";

export type ReceiptRow = typeof schema.receipts.$inferSelect;
export type ReceivingType = (typeof RECEIVING_TYPES)[number];

export interface RecordReceiptInput {
  readonly type: ReceivingType;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly productId: string;
  readonly packType?: string;
  /** Quantity in `packType` units. */
  readonly quantity: number;
  readonly locationId: string;
  readonly lpId?: string | null;
  readonly parentLpId?: string | null;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly damageReason?: string | null;
  /** Damage photo (files id) captured per receive line. */
  readonly damageImageFileId?: string | null;
  readonly purchaseOrderId?: string | null;
  readonly purchaseOrderLineId?: string | null;
  readonly returnOrderId?: string | null;
  readonly returnOrderLineId?: string | null;
  readonly shipmentOrderId?: string | null;
  readonly workOrderId?: string | null;
  readonly customerReturnReason?: string | null;
  readonly actualReturnReason?: string | null;
  readonly note?: string | null;
  readonly lineNote?: string | null;
  readonly serials?: readonly { readonly primary: string; readonly secondary?: string | null }[];
  /** Ledger transaction type; defaults from `type` (see `receiptTxnType`). */
  readonly txnType?: TxnType;
  /** Putaway algorithm / rule that suggested the location (Transaction History columns). */
  readonly algorithmName?: string | null;
  readonly algorithmRuleName?: string | null;
}

/** Ledger type a receipt posts under (Logiwa: kit output "Kitting", breakdown returns "Disassemble Kit"). */
export function receiptTxnType(type: ReceivingType): TxnType {
  if (type === "Return") return "Return Receiving";
  if (type === "Kitting") return "Kitting";
  if (type === "DisassembleKit") return "Disassemble Kit";
  return "Receiving";
}

const RECEIPT_SEQUENCE = "receipt";

function productSku(tx: Tx, productId: string): string {
  return tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).get()?.sku ?? productId;
}

function applyPoReceipt(tx: Tx, ctx: DomainCtx, input: RecordReceiptInput, qty: number): void {
  if (!input.purchaseOrderId) return;
  const po = tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, input.purchaseOrderId)).get();
  if (!po) throw new DomainError("NOT_FOUND", "Purchase order not found");
  checkScope(ctx, po, "Purchase order");
  if (po.status === "Completed" || po.status === "Cancelled") {
    throw new DomainError("INVALID_STATE", `A purchase order in ${po.status.toLowerCase()} status can't be received.`);
  }
  if (po.warehouseId !== input.warehouseId || po.clientId !== input.clientId) throw new DomainError("VALIDATION", "Receipt warehouse/client must match the purchase order.");
  const status = po.status === "Receiving" ? po.status : stateMachines.purchaseOrder.transition(po.status, "Receiving");
  tx.update(schema.purchaseOrders).set({
    status, receivedQuantity: sql`${schema.purchaseOrders.receivedQuantity} + ${qty}`, receivedAt: po.receivedAt ?? nowIso(), updatedBy: ctx.userId,
  }).where(eq(schema.purchaseOrders.id, po.id)).run();
  if (!input.purchaseOrderLineId) return;
  const line = tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, input.purchaseOrderLineId)).get();
  if (!line || line.purchaseOrderId !== po.id) throw new DomainError("NOT_FOUND", "Purchase order line not found");
  if (line.productId !== input.productId) throw new DomainError("VALIDATION", "The received product does not match the purchase order line.");
  tx.update(schema.purchaseOrderLines).set({ receivedQuantity: line.receivedQuantity + qty, updatedBy: ctx.userId })
    .where(eq(schema.purchaseOrderLines.id, line.id)).run();
  recordLine(tx, ctx, {
    entityType: "purchase_order", entityId: po.id, entityCode: po.code, lineEntityType: "purchase_order_line",
    lineEntityId: line.id, lineLabel: productSku(tx, line.productId), field: "receivedQuantity", from: line.receivedQuantity, to: line.receivedQuantity + qty,
  });
}

function applyReturnReceipt(tx: Tx, ctx: DomainCtx, input: RecordReceiptInput, qty: number): void {
  if (!input.returnOrderId) return;
  const ro = tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, input.returnOrderId)).get();
  if (!ro) throw new DomainError("NOT_FOUND", "Return order not found");
  checkScope(ctx, ro, "Return order");
  if (ro.status === "Completed" || ro.status === "Cancelled") throw new DomainError("INVALID_STATE", `A return in ${ro.status.toLowerCase()} status can't be received.`);
  if (ro.status !== "Started") {
    tx.update(schema.returnOrders).set({ status: stateMachines.returnOrder.transition(ro.status, "Started"), actualReturnDate: nowIso(), updatedBy: ctx.userId })
      .where(eq(schema.returnOrders.id, ro.id)).run();
  }
  if (!input.returnOrderLineId) return;
  const line = tx.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, input.returnOrderLineId)).get();
  if (!line || line.returnOrderId !== ro.id) throw new DomainError("NOT_FOUND", "Return line not found");
  tx.update(schema.returnOrderLines).set({ returnedQty: line.returnedQty + qty, lineStatus: "Started", updatedBy: ctx.userId })
    .where(eq(schema.returnOrderLines.id, line.id)).run();
}

export function recordReceipt(tx: Tx, ctx: DomainCtx, input: RecordReceiptInput): { receipt: ReceiptRow; txn: TxnRow } {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("VALIDATION", "Received quantity must be a positive whole number");
  const product = tx.select().from(schema.products).where(eq(schema.products.id, input.productId)).get();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const packType = input.packType ?? product.uom;
  const uomQuantity = input.quantity * packRatio(tx, product.id, packType);
  if (product.trackSerial && input.serials && input.serials.length !== uomQuantity) {
    throw new DomainError("VALIDATION", `${uomQuantity} serial numbers are required; ${input.serials.length} entered.`);
  }
  applyPoReceipt(tx, ctx, input, input.quantity);
  applyReturnReceipt(tx, ctx, input, input.quantity);
  const poCode = input.purchaseOrderId
    ? tx.select({ code: schema.purchaseOrders.code }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, input.purchaseOrderId)).get()?.code ?? null
    : null;
  const receipt = tx.insert(schema.receipts).values({
    masterId: nextInteger(tx, RECEIPT_SEQUENCE), type: input.type, warehouseId: input.warehouseId, clientId: input.clientId,
    purchaseOrderId: input.purchaseOrderId ?? null, purchaseOrderLineId: input.purchaseOrderLineId ?? null,
    workOrderId: input.workOrderId ?? null, shipmentOrderId: input.shipmentOrderId ?? null,
    returnOrderId: input.returnOrderId ?? null, returnOrderLineId: input.returnOrderLineId ?? null,
    productId: product.id, packType, quantity: input.quantity, uomQuantity, lotNumber: input.lotNumber ?? null,
    expiryDate: input.expiryDate ?? null, productionDate: input.productionDate ?? null, locationId: input.locationId,
    lpId: input.lpId ?? null, parentLpId: input.parentLpId ?? null, damageReason: input.damageReason ?? null,
    damageImageFileId: input.damageImageFileId ?? null,
    customerReturnReason: input.customerReturnReason ?? null, actualReturnReason: input.actualReturnReason ?? null,
    note: input.note ?? null, lineNote: input.lineNote ?? null, receivedBy: ctx.source,
  }).returning().get();
  const { bucket, txn } = add(tx, ctx, {
    warehouseId: input.warehouseId, clientId: input.clientId, productId: product.id, locationId: input.locationId,
    lpId: input.lpId, lotNumber: input.lotNumber, expiryDate: input.expiryDate, productionDate: input.productionDate,
    damageReason: input.damageReason, packType, qty: uomQuantity, poNumber: poCode,
    type: input.txnType ?? receiptTxnType(input.type),
    refs: {
      receiptId: receipt.id, purchaseOrderId: input.purchaseOrderId, returnOrderId: input.returnOrderId, workOrderId: input.workOrderId, orderId: input.shipmentOrderId, note: input.note,
      algorithmName: input.algorithmName ?? null, algorithmRuleName: input.algorithmRuleName ?? null,
    },
  });
  if (!txn) throw new DomainError("INVALID_STATE", "Receipt did not post a transaction");
  const updated = tx.update(schema.receipts).set({ inventoryTransactionId: txn.id }).where(eq(schema.receipts.id, receipt.id)).returning().get();
  if (input.serials && input.serials.length > 0) {
    registerSerials(tx, ctx, { productId: product.id, warehouseId: input.warehouseId, clientId: input.clientId, serials: input.serials, inventoryId: bucket.id, receiptId: receipt.id, txnId: txn.id });
  } else if (input.type === "Return" && product.trackSerial && input.returnOrderLineId) {
    // No serials scanned on the return: bring back the serials that shipped on the original order line.
    const orderLineId = tx.select({ orderLineId: schema.returnOrderLines.orderLineId }).from(schema.returnOrderLines)
      .where(eq(schema.returnOrderLines.id, input.returnOrderLineId)).get()?.orderLineId;
    if (orderLineId) restockReturnedSerials(tx, ctx, { orderLineId, productId: product.id, inventoryId: bucket.id, qty: uomQuantity, txnId: txn.id });
  }
  return { receipt: updated, txn };
}

export const CANCEL_COMPLETED_PO_MESSAGE = "A received line of an order in completed status can't be cancelled.";

export function cancelReceipt(tx: Tx, ctx: DomainCtx, input: { receiptId: string }): { receipt: ReceiptRow; txn: TxnRow | null } {
  const receipt = tx.select().from(schema.receipts).where(eq(schema.receipts.id, input.receiptId)).get();
  if (!receipt) throw new DomainError("NOT_FOUND", "Receipt not found");
  checkScope(ctx, receipt, "Receipt");
  if (receipt.cancelledAt) throw new DomainError("INVALID_STATE", "This receipt is already cancelled.");
  if (receipt.purchaseOrderId) {
    const po = tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, receipt.purchaseOrderId)).get();
    if (po?.status === "Completed") throw new DomainError("INVALID_STATE", CANCEL_COMPLETED_PO_MESSAGE);
    if (po) {
      tx.update(schema.purchaseOrders).set({ receivedQuantity: Math.max(0, po.receivedQuantity - receipt.quantity), updatedBy: ctx.userId })
        .where(eq(schema.purchaseOrders.id, po.id)).run();
    }
    if (receipt.purchaseOrderLineId) {
      const line = tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, receipt.purchaseOrderLineId)).get();
      if (line) {
        tx.update(schema.purchaseOrderLines).set({ receivedQuantity: Math.max(0, line.receivedQuantity - receipt.quantity), updatedBy: ctx.userId })
          .where(eq(schema.purchaseOrderLines.id, line.id)).run();
        if (po) {
          recordLine(tx, ctx, { entityType: "purchase_order", entityId: po.id, entityCode: po.code, lineEntityType: "purchase_order_line",
            lineEntityId: line.id, lineLabel: productSku(tx, line.productId), field: "receivedQuantity", from: line.receivedQuantity, to: Math.max(0, line.receivedQuantity - receipt.quantity) });
        }
      }
    }
  }
  if (receipt.returnOrderLineId) {
    const line = tx.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, receipt.returnOrderLineId)).get();
    if (line) tx.update(schema.returnOrderLines).set({ returnedQty: Math.max(0, line.returnedQty - receipt.quantity) }).where(eq(schema.returnOrderLines.id, line.id)).run();
  }
  const posted = receipt.inventoryTransactionId
    ? tx.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.id, receipt.inventoryTransactionId)).get()
    : undefined;
  let txn: TxnRow | null = null;
  if (posted?.toInventoryId) {
    const bucket = getBucket(tx, posted.toInventoryId);
    txn = remove(tx, ctx, { inventoryId: bucket.id, qty: receipt.uomQuantity, type: "Cancel Receiving", refs: { receiptId: receipt.id, purchaseOrderId: receipt.purchaseOrderId, returnOrderId: receipt.returnOrderId } }).txn;
    if (txn) cancelReceiptSerials(tx, ctx, receipt.id, txn.id);
  }
  const updated = tx.update(schema.receipts).set({ cancelledAt: nowIso(), cancelledBy: ctx.source })
    .where(eq(schema.receipts.id, receipt.id)).returning().get();
  return { receipt: updated, txn };
}
