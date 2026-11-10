/**
 * Purchase order serial pre-advice (M05): Import PO Serial Numbers attaches expected serials
 * to PO lines (`purchase_order_serials`); Remove Serial Number clears them. Pre-advice is not
 * stock: nothing touches the ledger. The Receive items drawer prefills a serial-tracked line
 * with its pre-advised serials that have not been received yet.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError } from "@/server/api/errors";
import { assertInScope, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, type DomainCtx } from "@/server/domain";

const po = schema.purchaseOrders;
const line = schema.purchaseOrderLines;
const pos = schema.purchaseOrderSerials;

export const PO_SERIAL_OPEN_STATUSES = ["Pending", "Started", "Receiving"] as const;

const clean = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

export interface PreAdviceResult {
  readonly purchaseOrderId: string;
  readonly code: string;
  readonly lineId: string;
  readonly sku: string;
}

/**
 * Attaches one serial to the first line of `sku` on PO `poCode` that still has room
 * (ordered × pack ratio minus serials already pre-advised). Rules: the PO is open and in
 * scope, the SKU is serial tracked and on the PO, the serial is new for that product (not
 * pre-advised on an open PO, not already in stock or shipped).
 */
export function preAdviseSerial(tx: AppDb, ctx: DomainCtx, scope: Scope, input: { poCode: unknown; sku: unknown; serial: unknown }): PreAdviceResult {
  const code = clean(input.poCode);
  const sku = clean(input.sku);
  const serial = clean(input.serial);
  if (!code) throw new AppError("VALIDATION", "PO Code is required");
  if (!sku) throw new AppError("VALIDATION", "SKU is required");
  if (!serial) throw new AppError("VALIDATION", "Serial Number is required");
  if (serial.length > 100) throw new AppError("VALIDATION", "Serial Number can be at most 100 characters");
  const order = tx.select().from(po).where(sql`lower(${po.code}) = lower(${code})`).get();
  if (!order) throw notFoundError(`Purchase order ${code}`);
  assertInScope(scope, order, "Purchase order");
  if (!(PO_SERIAL_OPEN_STATUSES as readonly string[]).includes(order.status)) {
    throw new AppError("INVALID_STATE", `${order.code} is ${order.status === "Receiving" ? "Started" : order.status}: serials can only be added to Pending or Started orders`);
  }
  const product = tx.select().from(schema.products).where(and(eq(schema.products.clientId, order.clientId), sql`lower(${schema.products.sku}) = lower(${sku})`)).get();
  if (!product) throw new AppError("VALIDATION", `SKU ${sku} not found for this purchase order's client`);
  if (!product.trackSerial) throw new AppError("VALIDATION", `${product.sku} is not serial tracked`);
  const lines = tx.select().from(line).where(and(eq(line.purchaseOrderId, order.id), eq(line.productId, product.id))).orderBy(asc(line.createdAt), sql`"purchase_order_lines".rowid`).all();
  if (lines.length === 0) throw new AppError("VALIDATION", `${product.sku} is not on ${order.code}`);
  const dupPo = tx.select({ code: po.code }).from(pos).innerJoin(line, eq(line.id, pos.purchaseOrderLineId)).innerJoin(po, eq(po.id, line.purchaseOrderId))
    .where(and(eq(line.productId, product.id), sql`lower(${pos.serial}) = lower(${serial})`, inArray(po.status, [...PO_SERIAL_OPEN_STATUSES]))).get();
  if (dupPo) throw new AppError("DUPLICATE", `Serial ${serial} is already pre-advised on ${dupPo.code}`);
  const inStock = tx.select({ status: schema.serialNumbers.status }).from(schema.serialNumbers)
    .where(and(eq(schema.serialNumbers.productId, product.id), sql`lower(${schema.serialNumbers.primarySerial}) = lower(${serial})`)).get();
  if (inStock) throw new AppError("DUPLICATE", `Serial ${serial} already exists for ${product.sku} (${inStock.status})`);
  const counts = new Map(tx.select({ lineId: pos.purchaseOrderLineId, n: sql<number>`count(*)` }).from(pos)
    .where(inArray(pos.purchaseOrderLineId, lines.map((l) => l.id))).groupBy(pos.purchaseOrderLineId).all().map((r) => [r.lineId, Number(r.n)]));
  const target = lines.find((l) => (counts.get(l.id) ?? 0) < Math.max(0, l.orderedQuantity * l.uomQuantity));
  if (!target) {
    const capacity = lines.reduce((s, l) => s + l.orderedQuantity * l.uomQuantity, 0);
    throw new AppError("VALIDATION", `${product.sku} on ${order.code} already has ${capacity} serial number${capacity === 1 ? "" : "s"} (one per ordered unit)`);
  }
  tx.insert(pos).values({ purchaseOrderLineId: target.id, serial, createdBy: ctx.userId }).run();
  changeLog.recordLine(tx, ctx, {
    entityType: "purchase_order", entityId: order.id, entityCode: order.code,
    lineEntityType: "purchase_order_line", lineEntityId: target.id, lineLabel: product.sku, field: "serialNumber", from: "", to: serial,
  });
  return { purchaseOrderId: order.id, code: order.code, lineId: target.id, sku: product.sku };
}

/** Pre-advised serial count per PO (list rows, Remove Serial Number gating). */
export function preAdvisedCounts(db: AppDb, poIds: readonly string[]): Map<string, number> {
  if (poIds.length === 0) return new Map();
  return new Map(db.select({ poId: line.purchaseOrderId, n: sql<number>`count(*)` }).from(pos).innerJoin(line, eq(line.id, pos.purchaseOrderLineId))
    .where(inArray(line.purchaseOrderId, [...poIds])).groupBy(line.purchaseOrderId).all().map((r) => [r.poId, Number(r.n)]));
}

export interface PreAdvisedSerial {
  readonly serial: string;
  /** True once a receipt registered this serial for the line's product. */
  readonly received: boolean;
}

/** Pre-advised serials per line, in import order, with their received state. */
export function preAdvisedByLine(db: AppDb, poId: string): Map<string, PreAdvisedSerial[]> {
  const rows = db.select({ lineId: pos.purchaseOrderLineId, serial: pos.serial, productId: line.productId }).from(pos).innerJoin(line, eq(line.id, pos.purchaseOrderLineId))
    .where(eq(line.purchaseOrderId, poId)).orderBy(asc(pos.createdAt), sql`"purchase_order_serials".rowid`).all();
  const out = new Map<string, PreAdvisedSerial[]>();
  if (rows.length === 0) return out;
  const known = new Set(db.select({ productId: schema.serialNumbers.productId, serial: schema.serialNumbers.primarySerial }).from(schema.serialNumbers)
    .where(and(inArray(schema.serialNumbers.productId, [...new Set(rows.map((r) => r.productId))]), inArray(sql`lower(${schema.serialNumbers.primarySerial})`, rows.map((r) => r.serial.toLowerCase())))).all()
    .map((r) => `${r.productId}|${r.serial.toLowerCase()}`));
  for (const r of rows) out.set(r.lineId, [...(out.get(r.lineId) ?? []), { serial: r.serial, received: known.has(`${r.productId}|${r.serial.toLowerCase()}`) }]);
  return out;
}

/**
 * Remove Serial Number: clears every pre-advised serial on the PO (received serials stay on
 * their receipts; only the pre-advice goes). Logs one line entry per serial.
 */
export function removePreAdvisedSerials(tx: AppDb, ctx: DomainCtx, scope: Scope, poId: string): { code: string; removed: number } {
  const order = tx.select().from(po).where(eq(po.id, poId)).get();
  if (!order) throw notFoundError("Purchase order");
  assertInScope(scope, order, "Purchase order");
  const rows = tx.select({ id: pos.id, serial: pos.serial, lineId: pos.purchaseOrderLineId, sku: schema.products.sku }).from(pos)
    .innerJoin(line, eq(line.id, pos.purchaseOrderLineId)).innerJoin(schema.products, eq(schema.products.id, line.productId))
    .where(eq(line.purchaseOrderId, poId)).all();
  if (rows.length === 0) throw new AppError("INVALID_STATE", `${order.code} has no pre-advised serial numbers`);
  tx.delete(pos).where(inArray(pos.id, rows.map((r) => r.id))).run();
  for (const r of rows) {
    changeLog.recordLine(tx, ctx, {
      entityType: "purchase_order", entityId: order.id, entityCode: order.code,
      lineEntityType: "purchase_order_line", lineEntityId: r.lineId, lineLabel: r.sku, field: "serialNumber", from: r.serial, to: "",
    });
  }
  return { code: order.code, removed: rows.length };
}
