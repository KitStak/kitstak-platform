/**
 * Purchase orders — commands (M05, table owner of purchase_orders / purchase_order_lines).
 * Status changes go through `po-status-rules` (shared machine + the Completed -> Started re-open); every write logs change_log
 * rows (header fields and SKU-prefixed line entries).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { purchasePriceOf, type PoCreateValues, type PoLineValues, type PoUpdateValues } from "@/lib/grid-defs/receiving/po-schemas";
import type { PoStatus } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import { assertInScope, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, type DomainCtx } from "@/server/domain";
import { runWorkflows } from "@/server/domain/workflows";
import { assertVersion } from "./platform-common";
import { getPurchaseOrder, poCodeTaken, type PurchaseOrderDetail } from "./purchase-orders";
import { logSnapshot, logValue, warehouseTimeZone } from "./purchase-orders-log";
import { assertPoStatusChange } from "./po-status-rules";

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
  // An API client that omits the pack type gets the product's base pack type (e.g. "Unit").
  const packType = l.packType || product.uom;
  return {
    productId: l.productId, orderedQuantity: l.orderedQuantity, unitCost: Math.round(l.unitCost * 100) / 100, packType,
    uomQuantity: packRatioOf(tx, product, packType), receivingLocationId: l.receivingLocationId || null,
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
    changeLog.recordLineCreate(tx, ctx, { entityType: "purchase_order", entityId: created.id, entityCode: created.code, lineEntityType: "purchase_order_line",
      lineEntityId: inserted.id, lineLabel: product.sku });
  }
  tx.update(po).set(totalsOf(tx, created.id)).where(eq(po.id, created.id)).run();
  // M12 "Purchase Order Created" workflows (conditions on PO facts; Notify Users).
  runWorkflows(tx, ctx, "Purchase Order Created", { type: "purchase_order", id: created.id });
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
    // Pre-advised serials belong to the line (FK): they go with it.
    tx.delete(schema.purchaseOrderSerials).where(eq(schema.purchaseOrderSerials.purchaseOrderLineId, l.id)).run();
    tx.delete(line).where(eq(line.id, l.id)).run();
    changeLog.recordLineDelete(tx, ctx, { ...ref, lineEntityId: l.id, lineLabel: skuOf(l.productId) });
  }
  for (const l of changed) {
    const e = existing.find((x) => x.id === l.id) as typeof line.$inferSelect;
    const product = products.get(l.productId) as typeof schema.products.$inferSelect;
    if (e.productId !== l.productId && e.receivedQuantity > 0) throw new AppError("INVALID_STATE", `The product of a received line can't change (${product.sku}).`);
    const next = lineValues(tx, product, l, ctx);
    tx.update(line).set({ ...next, version: e.version + 1 }).where(eq(line.id, e.id)).run();
    for (const f of LINE_FIELDS) {
      if (String(e[f] ?? "") === String(next[f] ?? "")) continue;
      changeLog.recordLine(tx, ctx, { ...ref, lineEntityId: e.id, lineLabel: product.sku, field: f, from: logValue(f, e[f]), to: logValue(f, next[f]) });
    }
  }
  for (const l of added) {
    const product = products.get(l.productId) as typeof schema.products.$inferSelect;
    const inserted = tx.insert(line).values({ ...lineValues(tx, product, l, ctx), purchaseOrderId: id, createdBy: ctx.userId }).returning().get();
    changeLog.recordLineCreate(tx, ctx, { ...ref, lineEntityId: inserted.id, lineLabel: product.sku });
  }
  tx.update(po).set({
    code: values.code, warehouseId: values.warehouseId, poType: values.poType, poDate: values.poDate, plannedReceivingDate: values.plannedReceivingDate,
    expectedDate: values.plannedReceivingDate, receivedAt: values.receivedAt, plannedArrivalDate: values.plannedArrivalDate,
    actualArrivalDate: values.actualArrivalDate, referenceNumber: values.referenceNumber, note: values.note, vendorId: vendor.id,
    vendorName: vendor.displayName, customFields: values.customFields, ...totalsOf(tx, id), updatedBy: ctx.userId, version: before.version + 1,
  }).where(eq(po.id, id)).run();
  const after = tx.select().from(po).where(eq(po.id, id)).get() as PoRow;
  const tz = warehouseTimeZone(tx, after.warehouseId);
  changeLog.recordUpdate(tx, ctx, { entityType: "purchase_order", entityId: id, entityCode: after.code, before: logSnapshot(headerOf(before), tz), after: logSnapshot(headerOf(after), tz) });
  return getPurchaseOrder(tx, scope, id);
}

function activeReceiptCount(tx: AppDb, poId: string): number {
  return tx.select({ n: sql<number>`count(*)` }).from(schema.receipts).where(and(eq(schema.receipts.purchaseOrderId, poId), sql`${schema.receipts.cancelledAt} IS NULL`)).get()?.n ?? 0;
}

const displayStatus = (s: string): string => (s === "Receiving" ? "Started" : s);

/** Persists a status change validated by the state machine, with change_log rows. */
export function applyStatus(tx: AppDb, ctx: DomainCtx, before: PoRow, to: PoStatus, extra: Partial<typeof po.$inferInsert> = {}, reason?: string): PoRow {
  const status = assertPoStatusChange(before.status, to, { activeReceipts: activeReceiptCount(tx, before.id) });
  tx.update(po).set({ ...extra, status, updatedBy: ctx.userId, version: before.version + 1 }).where(eq(po.id, before.id)).run();
  const after = tx.select().from(po).where(eq(po.id, before.id)).get() as PoRow;
  const tz = warehouseTimeZone(tx, before.warehouseId);
  changeLog.recordUpdate(tx, ctx, {
    entityType: "purchase_order", entityId: before.id, entityCode: before.code,
    before: logSnapshot({ status: displayStatus(before.status), completedAt: before.completedAt, cancelledAt: before.cancelledAt, receivedAt: before.receivedAt, ...(reason ? { statusChangeReason: "" } : {}) }, tz),
    after: logSnapshot({ status: displayStatus(after.status), completedAt: after.completedAt, cancelledAt: after.cancelledAt, receivedAt: after.receivedAt, ...(reason ? { statusChangeReason: reason } : {}) }, tz),
  });
  return after;
}

/** Units still expected on a PO (ordered minus received, per line, never negative). */
export function openUnits(tx: AppDb, poId: string): { units: number; lines: number } {
  const rows = tx.select({ ordered: line.orderedQuantity, received: line.receivedQuantity }).from(line).where(eq(line.purchaseOrderId, poId)).all();
  const open = rows.map((r) => Math.max(0, r.ordered - r.received)).filter((n) => n > 0);
  return { units: open.reduce((s, n) => s + n, 0), lines: open.length };
}

export const shortCloseReason = (units: number, lines: number): string =>
  `Open balance cancelled: ${units.toLocaleString("en-US")} unit${units === 1 ? "" : "s"} on ${lines} line${lines === 1 ? "" : "s"} will not be received. Received lines and their stock are kept.`;

export interface CancelOutcome {
  readonly row: PoRow;
  /** True when the PO had receipts: the open balance was cancelled and the PO closed as Completed. */
  readonly shortClosed: boolean;
  readonly cancelledUnits: number;
}

/**
 * Cancel Order. A PO without active receipts becomes Cancelled. A Started PO that already has
 * receipts is short-closed instead (Logiwa enables Cancel Order on a Started PO with open
 * lines): the open balance stops being expected, received lines and their stock stay
 * untouched, and the PO closes as Completed with the reason on the change log. Received stock
 * is never reversed to cancel a PO.
 */
export function cancelPurchaseOrderOutcome(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, version?: number): CancelOutcome {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, version);
  if (before.status !== "Pending" && before.status !== "Started" && before.status !== "Receiving") {
    throw new AppError("INVALID_STATE", `A ${before.status.toLowerCase()} purchase order can't be cancelled. Only Pending or Started orders can.`);
  }
  const open = openUnits(tx, id);
  if (activeReceiptCount(tx, id) > 0) {
    const now = new Date().toISOString();
    const row = applyStatus(tx, ctx, before, "Completed", { completedAt: now, receivedAt: before.receivedAt ?? now }, shortCloseReason(open.units, open.lines));
    return { row, shortClosed: true, cancelledUnits: open.units };
  }
  return { row: applyStatus(tx, ctx, before, "Cancelled", { cancelledAt: new Date().toISOString() }), shortClosed: false, cancelledUnits: open.units };
}

export function cancelPurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, version?: number): PoRow {
  return cancelPurchaseOrderOutcome(tx, ctx, scope, id, version).row;
}

export const DELETE_PO_RULE = "Only Pending purchase orders without receipts can be deleted.";

export function deletePurchaseOrder(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, version?: number): void {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, version);
  const receipts = tx.select({ n: sql<number>`count(*)` }).from(schema.receipts).where(eq(schema.receipts.purchaseOrderId, id)).get()?.n ?? 0;
  if (before.status !== "Pending" || receipts > 0) throw new AppError("INVALID_STATE", DELETE_PO_RULE);
  tx.delete(schema.purchaseOrderSerials).where(inArray(schema.purchaseOrderSerials.purchaseOrderLineId, tx.select({ id: line.id }).from(line).where(eq(line.purchaseOrderId, id)))).run();
  tx.delete(line).where(eq(line.purchaseOrderId, id)).run();
  tx.delete(po).where(eq(po.id, id)).run();
  changeLog.recordDelete(tx, ctx, { entityType: "purchase_order", entityId: id, entityCode: before.code });
}

/**
 * Date stamps for a manual status change. Completed stamps Completed / Actual Receiving;
 * Cancelled stamps Cancelled; re-opening a Completed order (Completed -> Started, Logiwa
 * parity, needs the state-machine edge from REQ-R2-3) clears Completed / Actual Receiving.
 */
export function statusChangeStamps(before: Pick<PoRow, "status" | "receivedAt">, to: PoStatus, now: string): Partial<typeof po.$inferInsert> {
  if (to === "Completed") return { completedAt: now, receivedAt: now };
  if (to === "Cancelled") return { cancelledAt: now };
  if (before.status === "Completed") return { completedAt: null, receivedAt: null };
  return {};
}

export function changePurchaseOrderStatus(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string, input: { status: PoStatus; reason: string; version: number }): PurchaseOrderDetail {
  const before = loadPo(tx, scope, id);
  assertVersion(before.version, input.version);
  if (input.status === "Receiving") throw new AppError("VALIDATION", "Receiving is set by receipts and can't be chosen manually.");
  if (input.status === before.status || (input.status === "Started" && before.status === "Receiving")) {
    throw new AppError("VALIDATION", "Choose a different status.", { fieldErrors: { status: ["Choose a different status."] } });
  }
  const now = new Date().toISOString();
  const extra = statusChangeStamps(before, input.status, now);
  applyStatus(tx, ctx, before, input.status, extra, input.reason);
  return getPurchaseOrder(tx, scope, id);
}
