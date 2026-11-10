/**
 * Purchase orders — commands (M05, table owner of purchase_orders / purchase_order_lines).
 * Status changes go through `stateMachines.purchaseOrder`; every write logs change_log
 * rows (header fields and SKU-prefixed line entries).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { purchasePriceOf, type PoCreateValues, type PoLineValues, type PoUpdateValues } from "@/lib/grid-defs/receiving/po-schemas";
import type { PoStatus } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import { assertInScope, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, stateMachines, type DomainCtx } from "@/server/domain";
import { assertVersion } from "./platform-common";
import { getPurchaseOrder, poCodeTaken, type PurchaseOrderDetail } from "./purchase-orders";

const po = schema.purchaseOrders;
const line = schema.purchaseOrderLines;
type PoRow = typeof po.$inferSelect;

export const duplicateCodeMessage = (code: string): string => `This purchase order code already exists (${code})`;

function assertCodeFree(tx: AppDb, code: string, exceptId?: string): void {
  if (poCodeTaken(tx, code, exceptId).taken) {
    throw new AppError("DUPLICATE", duplicateCodeMessage(code), { fieldErrors: { code: [duplicateCodeMessage(code)] } });
  }
}

function loadPo(tx: AppDb, scope: Scope, id: string): PoRow {
  const row = tx.select().from(po).where(eq(po.id, id)).get();
  if (!row) throw notFoundError("Purchase order");
  assertInScope(scope, row, "Purchase order");
  return row;
}

function assertWarehouse(tx: AppDb, scope: Scope, warehouseId: string): void {
  assertInScope(scope, { warehouseId }, "Warehouse");
  if (!tx.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).get()) throw notFoundError("Warehouse");
}

function vendorFor(tx: AppDb, clientId: string, vendorId: string): typeof schema.vendors.$inferSelect {
  const vendor = tx.select().from(schema.vendors).where(eq(schema.vendors.id, vendorId)).get();
  if (!vendor || vendor.clientId !== clientId) {
    throw new AppError("VALIDATION", "Select a vendor of this client.", { fieldErrors: { vendorId: ["Select a vendor of this client."] } });
  }
  if (!vendor.isActive) throw new AppError("VALIDATION", "This vendor is inactive.", { fieldErrors: { vendorId: ["This vendor is inactive."] } });
  return vendor;
}

function productsFor(tx: AppDb, clientId: string, lines: readonly PoLineValues[]): Map<string, typeof schema.products.$inferSelect> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const rows = tx.select().from(schema.products).where(inArray(schema.products.id, ids)).all();
  const map = new Map(rows.map((r) => [r.id, r]));
  lines.forEach((l, i) => {
    const p = map.get(l.productId);
    if (!p) throw new AppError("VALIDATION", "Product not found", { fieldErrors: { [`lines.${i}.productId`]: ["Product not found"] } });
    if (p.clientId !== clientId) throw new AppError("VALIDATION", `${p.sku} belongs to another client.`, { fieldErrors: { [`lines.${i}.productId`]: [`${p.sku} belongs to another client.`] } });
  });
  return map;
}

function packRatioOf(tx: AppDb, product: typeof schema.products.$inferSelect, packType: string): number {
  if (packType === product.uom) return 1;
  const row = tx.select({ uomQty: schema.productPackTypes.uomQty }).from(schema.productPackTypes)
    .where(and(eq(schema.productPackTypes.productId, product.id), eq(schema.productPackTypes.packType, packType))).get();
  if (!row) throw new AppError("VALIDATION", `${product.sku} has no "${packType}" pack type.`);
  return row.uomQty;
}

function lineValues(tx: AppDb, product: typeof schema.products.$inferSelect, l: PoLineValues, ctx: DomainCtx) {
  return {
    productId: l.productId, orderedQuantity: l.orderedQuantity, unitCost: Math.round(l.unitCost * 100) / 100, packType: l.packType,
    uomQuantity: packRatioOf(tx, product, l.packType), receivingLocationId: l.receivingLocationId || null,
    lotNumber: product.trackLot ? l.lotNumber : null, expiryDate: product.trackExpiry ? l.expiryDate : null,
    productionDate: product.trackProductionDate ? l.productionDate : null, lpTypeId: l.lpTypeId || null, lpNumber: l.lpNumber,
    note: l.note, updatedBy: ctx.userId,
  };
}

function totalsOf(tx: AppDb, poId: string): { totalQuantity: number; purchasePrice: number } {
  const rows = tx.select({ orderedQuantity: line.orderedQuantity, unitCost: line.unitCost }).from(line).where(eq(line.purchaseOrderId, poId)).all();
  return { totalQuantity: rows.reduce((s, r) => s + r.orderedQuantity, 0), purchasePrice: purchasePriceOf(rows) };
}

const headerOf = (r: PoRow) => ({
  code: r.code, warehouseId: r.warehouseId, poType: r.poType, poDate: r.poDate, plannedReceivingDate: r.plannedReceivingDate,
  receivedAt: r.receivedAt, plannedArrivalDate: r.plannedArrivalDate, actualArrivalDate: r.actualArrivalDate, referenceNumber: r.referenceNumber,
  note: r.note, vendorName: r.vendorName, status: r.status, totalQuantity: r.totalQuantity, purchasePrice: r.purchasePrice, completedAt: r.completedAt,
  cancelledAt: r.cancelledAt, ...Object.fromEntries(Object.entries(r.customFields ?? {}).map(([k, val]) => [`customField.${k}`, val])),
});

export function createPurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, values: PoCreateValues): PurchaseOrderDetail {
  assertWarehouse(tx, scope, values.warehouseId);
  assertInScope(scope, { clientId: values.clientId }, "Client");
  assertCodeFree(tx, values.code);
  const vendor = vendorFor(tx, values.clientId, values.vendorId);
  const products = productsFor(tx, values.clientId, values.lines);
  const created = tx.insert(po).values({
    code: values.code, warehouseId: values.warehouseId, clientId: values.clientId, vendorId: vendor.id, vendorName: vendor.displayName,
    referenceNumber: values.referenceNumber, status: "Pending", poType: values.poType, totalQuantity: 0, purchasePrice: 0,
    poDate: values.poDate, plannedReceivingDate: values.plannedReceivingDate, receivedAt: values.receivedAt,
    plannedArrivalDate: values.plannedArrivalDate, actualArrivalDate: values.actualArrivalDate, expectedDate: values.plannedReceivingDate,
    note: values.note, customFields: values.customFields, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "purchase_order", entityId: created.id, entityCode: created.code });
  for (const l of values.lines) {
    const product = products.get(l.productId) as typeof schema.products.$inferSelect;
    const inserted = tx.insert(line).values({ ...lineValues(tx, product, l, ctx), purchaseOrderId: created.id, createdBy: ctx.userId }).returning().get();
    changeLog.recordLine(tx, ctx, { entityType: "purchase_order", entityId: created.id, entityCode: created.code, lineEntityType: "purchase_order_line",
      lineEntityId: inserted.id, lineLabel: product.sku, field: "orderedQuantity", from: "", to: inserted.orderedQuantity });
  }
  tx.update(po).set(totalsOf(tx, created.id)).where(eq(po.id, created.id)).run();
  return getPurchaseOrder(tx, scope, created.id);
}

const LINE_FIELDS = ["orderedQuantity", "unitCost", "packType", "receivingLocationId", "lotNumber", "expiryDate", "productionDate", "lpTypeId", "lpNumber", "note"] as const;

export function updatePurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, values: PoUpdateValues): PurchaseOrderDetail {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, values.version);
  assertWarehouse(tx, scope, values.warehouseId);
  if (values.code !== before.code) assertCodeFree(tx, values.code, id);
  const vendor = vendorFor(tx, before.clientId, values.vendorId);
  const products = productsFor(tx, before.clientId, values.lines);
  const existing = tx.select().from(line).where(eq(line.purchaseOrderId, id)).all();
  const closed = before.status === "Completed" || before.status === "Cancelled";
  const received = existing.filter((l) => l.receivedQuantity > 0);
  if (values.warehouseId !== before.warehouseId && received.length > 0) {
    throw new AppError("INVALID_STATE", "The warehouse can't change after receiving started.", { fieldErrors: { warehouseId: ["The warehouse can't change after receiving started."] } });
  }
  const keep = new Set(values.lines.map((l) => l.id).filter(Boolean));
  const removed = existing.filter((l) => !keep.has(l.id));
  const added = values.lines.filter((l) => !l.id);
  const changed = values.lines.filter((l) => l.id && existing.some((e) => e.id === l.id));
  const lineDiff = (l: PoLineValues): boolean => {
    const e = existing.find((x) => x.id === l.id);
    if (!e) return true;
    const next = lineValues(tx, products.get(l.productId) as typeof schema.products.$inferSelect, l, ctx);
    return e.productId !== l.productId || LINE_FIELDS.some((f) => String(e[f] ?? "") !== String(next[f] ?? ""));
  };
  if (closed && (removed.length > 0 || added.length > 0 || changed.some(lineDiff))) {
    throw new AppError("INVALID_STATE", `Lines of a ${before.status.toLowerCase()} purchase order can't be changed.`);
  }
  const blocked = removed.find((l) => l.receivedQuantity > 0);
  if (blocked) throw new AppError("INVALID_STATE", "A line with received quantity can't be removed. Cancel its receipts first.");

  const skuOf = (productId: string) => products.get(productId)?.sku ?? tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, productId)).get()?.sku ?? "Line";
  const ref = { entityType: "purchase_order", entityId: id, entityCode: values.code, lineEntityType: "purchase_order_line" } as const;
  for (const l of removed) {
    tx.delete(line).where(eq(line.id, l.id)).run();
    changeLog.recordLine(tx, ctx, { ...ref, lineEntityId: l.id, lineLabel: skuOf(l.productId), field: "orderedQuantity", from: l.orderedQuantity, to: "" });
  }
  for (const l of changed) {
    const e = existing.find((x) => x.id === l.id) as typeof line.$inferSelect;
    const product = products.get(l.productId) as typeof schema.products.$inferSelect;
    if (e.productId !== l.productId && e.receivedQuantity > 0) throw new AppError("INVALID_STATE", `The product of a received line can't change (${product.sku}).`);
    const next = lineValues(tx, product, l, ctx);
    tx.update(line).set({ ...next, version: e.version + 1 }).where(eq(line.id, e.id)).run();
    for (const f of LINE_FIELDS) {
      changeLog.recordLine(tx, ctx, { ...ref, lineEntityId: e.id, lineLabel: product.sku, field: f, from: e[f] ?? "", to: next[f] ?? "" });
    }
  }
  for (const l of added) {
    const product = products.get(l.productId) as typeof schema.products.$inferSelect;
    const inserted = tx.insert(line).values({ ...lineValues(tx, product, l, ctx), purchaseOrderId: id, createdBy: ctx.userId }).returning().get();
    changeLog.recordLine(tx, ctx, { ...ref, lineEntityId: inserted.id, lineLabel: product.sku, field: "orderedQuantity", from: "", to: inserted.orderedQuantity });
  }
  tx.update(po).set({
    code: values.code, warehouseId: values.warehouseId, poType: values.poType, poDate: values.poDate, plannedReceivingDate: values.plannedReceivingDate,
    expectedDate: values.plannedReceivingDate, receivedAt: values.receivedAt, plannedArrivalDate: values.plannedArrivalDate,
    actualArrivalDate: values.actualArrivalDate, referenceNumber: values.referenceNumber, note: values.note, vendorId: vendor.id,
    vendorName: vendor.displayName, customFields: values.customFields, ...totalsOf(tx, id), updatedBy: ctx.userId, version: before.version + 1,
  }).where(eq(po.id, id)).run();
  const after = tx.select().from(po).where(eq(po.id, id)).get() as PoRow;
  changeLog.recordUpdate(tx, ctx, { entityType: "purchase_order", entityId: id, entityCode: after.code, before: headerOf(before), after: headerOf(after) });
  return getPurchaseOrder(tx, scope, id);
}

function activeReceiptCount(tx: AppDb, poId: string): number {
  return tx.select({ n: sql<number>`count(*)` }).from(schema.receipts).where(and(eq(schema.receipts.purchaseOrderId, poId), sql`${schema.receipts.cancelledAt} IS NULL`)).get()?.n ?? 0;
}

/** Persists a status change validated by the state machine, with change_log rows. */
export function applyStatus(tx: AppDb, ctx: DomainCtx, before: PoRow, to: PoStatus, extra: Partial<typeof po.$inferInsert> = {}, reason?: string): PoRow {
  const status = stateMachines.purchaseOrder.transition(before.status, to, { activeReceipts: activeReceiptCount(tx, before.id) });
  tx.update(po).set({ ...extra, status, updatedBy: ctx.userId, version: before.version + 1 }).where(eq(po.id, before.id)).run();
  const after = tx.select().from(po).where(eq(po.id, before.id)).get() as PoRow;
  changeLog.recordUpdate(tx, ctx, {
    entityType: "purchase_order", entityId: before.id, entityCode: before.code,
    before: { status: before.status, completedAt: before.completedAt, cancelledAt: before.cancelledAt, receivedAt: before.receivedAt, ...(reason ? { statusChangeReason: "" } : {}) },
    after: { status: after.status, completedAt: after.completedAt, cancelledAt: after.cancelledAt, receivedAt: after.receivedAt, ...(reason ? { statusChangeReason: reason } : {}) },
  });
  return after;
}

export function cancelPurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, version?: number): PoRow {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, version);
  if (before.status !== "Pending" && before.status !== "Started" && before.status !== "Receiving") {
    throw new AppError("INVALID_STATE", `A ${before.status.toLowerCase()} purchase order can't be cancelled. Only Pending or Started orders can.`);
  }
  return applyStatus(tx, ctx, before, "Cancelled", { cancelledAt: new Date().toISOString() });
}

export const DELETE_PO_RULE = "Only Pending purchase orders without receipts can be deleted.";

export function deletePurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, version?: number): void {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, version);
  const receipts = tx.select({ n: sql<number>`count(*)` }).from(schema.receipts).where(eq(schema.receipts.purchaseOrderId, id)).get()?.n ?? 0;
  if (before.status !== "Pending" || receipts > 0) throw new AppError("INVALID_STATE", DELETE_PO_RULE);
  tx.delete(line).where(eq(line.purchaseOrderId, id)).run();
  tx.delete(po).where(eq(po.id, id)).run();
  changeLog.recordDelete(tx, ctx, { entityType: "purchase_order", entityId: id, entityCode: before.code });
}

export function changePurchaseOrderStatus(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, input: { status: PoStatus; reason: string; version: number }): PurchaseOrderDetail {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, input.version);
  if (input.status === "Receiving") throw new AppError("VALIDATION", "Receiving is set by receipts and can't be chosen manually.");
  if (input.status === before.status || (input.status === "Started" && before.status === "Receiving")) {
    throw new AppError("VALIDATION", "Choose a different status.", { fieldErrors: { status: ["Choose a different status."] } });
  }
  const now = new Date().toISOString();
  const extra = input.status === "Completed" ? { completedAt: now, receivedAt: before.receivedAt ?? now } : input.status === "Cancelled" ? { cancelledAt: now } : {};
  applyStatus(tx, ctx, before, input.status, extra, input.reason);
  return getPurchaseOrder(tx, scope, id);
}
