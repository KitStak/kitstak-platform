/**
 * Receiving History (M05): every receipt row (PO, return, kitting, add inventory…), the
 * receipt detail drawer and Cancel (reversal through `ledger.cancelReceipt`).
 * Scoped by the receipt's warehouse/client; cross-scope ids are NOT_FOUND.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { asc } from "@/server/db/order";
import { displayPoStatus } from "@/lib/grid-defs/receiving/purchase-orders";
import { RECEIPT_GRID_FIELDS, RECEIPT_SEARCH_FIELDS, RECEIPT_SORT_FIELDS } from "@/lib/grid-defs/receiving/receiving-history";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, scopedWhere, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, type DomainCtx } from "@/server/domain";
import { CANCEL_COMPLETED_PO_MESSAGE } from "@/server/domain/ledger";
import type { GridQuery } from "@/server/query/grid-query";
import { compileGrid, type GridSpec } from "./purchase-orders-grid";
import { logSnapshot, warehouseTimeZone } from "./purchase-orders-log";

const r = schema.receipts;

const sub = (q: SQL): SQL => sql`(${q})`;
const PRODUCT = (col: string) => sub(sql`SELECT ${sql.raw(col)} FROM products p WHERE p.id = ${r.productId}`);
const LP = (col: string, idCol: SQL) => sub(sql`SELECT ${sql.raw(col)} FROM license_plates lp WHERE lp.id = ${idCol}`);
const LP_TYPE = (idCol: SQL) => sub(sql`SELECT t.code FROM license_plates lp JOIN lp_types t ON t.id = lp.lp_type_id WHERE lp.id = ${idCol}`);

/** Receipts store the actor's email (or id); Logiwa shows the user's full name. */
const USER_NAME = (col: SQL): SQL => sql`COALESCE((SELECT u.name FROM users u WHERE u.email = ${col} OR u.id = ${col} LIMIT 1), ${col})`;

const EXPRS: Readonly<Record<string, SQL>> = {
  masterId: sql`CAST(${r.masterId} AS TEXT)`,
  poCode: sub(sql`SELECT po.code FROM purchase_orders po WHERE po.id = ${r.purchaseOrderId}`),
  poType: sub(sql`SELECT po.po_type FROM purchase_orders po WHERE po.id = ${r.purchaseOrderId}`),
  sku: PRODUCT("p.sku"),
  productName: PRODUCT("p.name"),
  barcode: PRODUCT("p.barcode"),
  uomPackType: PRODUCT("p.uom"),
  lotNumber: sql`${r.lotNumber}`,
  expiryDate: sql`${r.expiryDate}`,
  productionDate: sql`${r.productionDate}`,
  quantity: sql`${r.quantity}`,
  packType: sql`${r.packType}`,
  uomQuantity: sql`${r.uomQuantity}`,
  receivedAt: sql`${r.receivedAt}`,
  type: sql`${r.type}`,
  skuDetailsUpdated: sql`${r.skuDetailsUpdated}`,
  note: sql`${r.note}`,
  lineNote: sql`${r.lineNote}`,
  actualReturnReason: sql`${r.actualReturnReason}`,
  customerReturnReason: sql`${r.customerReturnReason}`,
  clientId: sql`${r.clientId}`,
  clientName: sub(sql`SELECT c.name FROM clients c WHERE c.id = ${r.clientId}`),
  warehouseId: sql`${r.warehouseId}`,
  warehouseName: sub(sql`SELECT w.name FROM warehouses w WHERE w.id = ${r.warehouseId}`),
  locationCode: sub(sql`SELECT l.code FROM locations l WHERE l.id = ${r.locationId}`),
  workOrderCode: sub(sql`SELECT wo.code FROM work_orders wo WHERE wo.id = ${r.workOrderId}`),
  shipmentOrderCode: sub(sql`SELECT so.code FROM shipment_orders so WHERE so.id = ${r.shipmentOrderId}`),
  storeOrderNumber: sub(sql`SELECT so.store_order_number FROM shipment_orders so WHERE so.id = ${r.shipmentOrderId}`),
  rmaNumber: sub(sql`SELECT ro.rma_code FROM return_orders ro WHERE ro.id = ${r.returnOrderId}`),
  lpNumber: LP("lp.number", sql`${r.lpId}`),
  lpType: LP_TYPE(sql`${r.lpId}`),
  parentLpNumber: LP("lp.number", sql`${r.parentLpId}`),
  parentLpType: LP_TYPE(sql`${r.parentLpId}`),
  damageReason: sql`${r.damageReason}`,
  receivedBy: USER_NAME(sql`${r.receivedBy}`),
};

const SPEC: GridSpec = {
  fields: RECEIPT_GRID_FIELDS,
  sortFields: RECEIPT_SORT_FIELDS,
  searchFields: RECEIPT_SEARCH_FIELDS,
  exprs: EXPRS,
  defaultOrder: [sql`${r.receivedAt} DESC`, sql`${r.masterId} DESC`],
};

export interface ReceiptRow {
  readonly id: string;
  readonly masterId: number;
  readonly purchaseOrderId: string | null;
  readonly poCode: string | null;
  readonly poType: string | null;
  readonly poStatus: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly quantity: number;
  readonly packType: string;
  readonly uomPackType: string;
  readonly uomQuantity: number;
  readonly receivedAt: string;
  readonly type: string;
  readonly skuDetailsUpdated: boolean;
  readonly note: string | null;
  readonly lineNote: string | null;
  readonly actualReturnReason: string | null;
  readonly customerReturnReason: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly workOrderId: string | null;
  readonly workOrderCode: string | null;
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly returnOrderId: string | null;
  readonly rmaNumber: string | null;
  readonly lpNumber: string | null;
  readonly lpType: string | null;
  readonly parentLpNumber: string | null;
  readonly parentLpType: string | null;
  readonly damageReason: string | null;
  readonly damageImageFileId: string | null;
  readonly receivedBy: string;
  readonly productionDate: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
  /** Why Cancel is unavailable (null when it can run). */
  readonly cancelBlockedReason: string | null;
  /** The warehouse's IANA time zone: every time in the module renders in it, labelled. */
  readonly timeZone: string;
}

const text = (e: SQL) => sql<string | null>`${e}`;
const SELECT = {
  id: r.id, masterId: r.masterId, purchaseOrderId: r.purchaseOrderId, poCode: text(EXPRS.poCode as SQL), poType: text(EXPRS.poType as SQL),
  poStatus: text(sub(sql`SELECT po.status FROM purchase_orders po WHERE po.id = ${r.purchaseOrderId}`)),
  productId: r.productId, sku: sql<string>`${EXPRS.sku}`, productName: sql<string>`${EXPRS.productName}`, barcode: sql<string>`${EXPRS.barcode}`,
  imageUrl: text(PRODUCT("p.image_url")), lotNumber: r.lotNumber, expiryDate: r.expiryDate, quantity: r.quantity, packType: r.packType,
  uomPackType: sql<string>`${EXPRS.uomPackType}`, uomQuantity: r.uomQuantity, receivedAt: r.receivedAt, type: r.type,
  skuDetailsUpdated: r.skuDetailsUpdated, note: r.note, lineNote: r.lineNote, actualReturnReason: r.actualReturnReason,
  customerReturnReason: r.customerReturnReason, clientId: r.clientId, clientName: sql<string>`${EXPRS.clientName}`, warehouseId: r.warehouseId,
  warehouseName: sql<string>`${EXPRS.warehouseName}`, locationId: r.locationId, locationCode: sql<string>`${EXPRS.locationCode}`,
  workOrderId: r.workOrderId, workOrderCode: text(EXPRS.workOrderCode as SQL), shipmentOrderId: r.shipmentOrderId,
  shipmentOrderCode: text(EXPRS.shipmentOrderCode as SQL), returnOrderId: r.returnOrderId, rmaNumber: text(EXPRS.rmaNumber as SQL),
  lpNumber: text(EXPRS.lpNumber as SQL), lpType: text(EXPRS.lpType as SQL), parentLpNumber: text(EXPRS.parentLpNumber as SQL),
  parentLpType: text(EXPRS.parentLpType as SQL), damageReason: r.damageReason, damageImageFileId: r.damageImageFileId, receivedBy: sql<string>`${EXPRS.receivedBy}`,
  productionDate: r.productionDate, cancelledAt: r.cancelledAt, cancelledBy: text(USER_NAME(sql`${r.cancelledBy}`)),
  timeZone: sql<string>`COALESCE((SELECT w.timezone FROM warehouses w WHERE w.id = ${r.warehouseId}), 'UTC')`,
};

type Base = Omit<ReceiptRow, "cancelBlockedReason" | "skuDetailsUpdated"> & { skuDetailsUpdated: boolean | number };

export function cancelBlockedReason(row: Pick<ReceiptRow, "cancelledAt" | "poStatus" | "type">): string | null {
  if (row.cancelledAt) return "This receipt is already cancelled.";
  if (row.poStatus === "Completed") return `${CANCEL_COMPLETED_PO_MESSAGE} Re-open the purchase order (change its status to Started) first.`;
  if (row.poStatus === "Cancelled") return "The purchase order is cancelled.";
  return null;
}

const shape = (b: Base): ReceiptRow => ({
  ...b, skuDetailsUpdated: Boolean(b.skuDetailsUpdated), poStatus: b.poStatus ? displayPoStatus(b.poStatus) : null,
  cancelBlockedReason: cancelBlockedReason({ cancelledAt: b.cancelledAt, poStatus: b.poStatus, type: b.type }),
});

export async function listReceipts(db: AppDb, auth: AuthContext, query: GridQuery, extra: readonly (SQL | undefined)[] = []): Promise<{ rows: ReceiptRow[]; total: number }> {
  const { where, orderBy } = compileGrid(SPEC, query, [scopedWhere(r, auth.viewScope), ...extra]);
  const total = (await db.select({ n: sql<number>`count(*)` }).from(r).where(where).limit(1))[0]?.n ?? 0;
  const rows = await db.select(SELECT).from(r).where(where).orderBy(...orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize) as Base[];
  return { rows: rows.map(shape), total };
}

export interface ReceiptDetail extends ReceiptRow {
  readonly serials: readonly { readonly primary: string; readonly secondary: string | null; readonly status: string }[];
  readonly transaction: { readonly id: string; readonly type: string; readonly at: string; readonly uomQty: number } | null;
  readonly siblings: readonly { readonly id: string; readonly masterId: number; readonly sku: string; readonly quantity: number; readonly receivedAt: string; readonly cancelledAt: string | null }[];
}

export async function getReceipt(db: AppDb, scope: Scope, id: string): Promise<ReceiptDetail> {
  const base = (await db.select(SELECT).from(r).where(eq(r.id, id)).limit(1))[0] as Base | undefined;
  if (!base) throw notFoundError("Receipt");
  assertInScope(scope, base, "Receipt");
  const row = shape(base);
  const serials = await db.select({ primary: schema.serialNumbers.primarySerial, secondary: schema.serialNumbers.secondarySerial, status: schema.serialNumbers.status })
    .from(schema.serialNumbers).where(eq(schema.serialNumbers.receiptId, id)).orderBy(asc(schema.serialNumbers.primarySerial));
  const txnRow = (await db.select({ id: schema.inventoryTransactions.id, type: schema.inventoryTransactions.type, at: schema.inventoryTransactions.at, uomQty: schema.inventoryTransactions.uomQty })
    .from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.receiptId, id)).orderBy(asc(schema.inventoryTransactions.seq)).limit(1))[0];
  const siblings = row.purchaseOrderId
    ? await db.select({ id: r.id, masterId: r.masterId, sku: sql<string>`${EXPRS.sku}`, quantity: r.quantity, receivedAt: r.receivedAt, cancelledAt: r.cancelledAt })
      .from(r).where(and(eq(r.purchaseOrderId, row.purchaseOrderId), sql`${r.id} <> ${id}`)).orderBy(asc(r.receivedAt)).limit(50)
    : [];
  return { ...row, serials, transaction: txnRow ?? null, siblings };
}

/** Cancel = reverse the receipt through the ledger; PO line / damage counters follow. */
export async function cancelReceipt(tx: AppDb, ctx: DomainCtx, scope: Scope, id: string): Promise<ReceiptDetail> {
  const before = await getReceipt(tx, scope, id);
  await ledger.cancelReceipt(tx, ctx, { receiptId: id });
  if (before.purchaseOrderId) {
    const po = (await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, before.purchaseOrderId)).limit(1))[0];
    if (po) {
      // Actual Receiving Date is a completion stamp (Logiwa parity): a PO that is open again has none.
      const reopen = po.status !== "Completed" && po.receivedAt ? { receivedAt: null } : {};
      await tx.update(schema.purchaseOrders).set({ ...reopen, version: po.version + 1, updatedBy: ctx.userId }).where(eq(schema.purchaseOrders.id, po.id));
      const units = before.uomQuantity === before.quantity ? `${before.quantity.toLocaleString("en-US")} ${before.packType}` : `${before.quantity.toLocaleString("en-US")} ${before.packType} (${before.uomQuantity.toLocaleString("en-US")} units)`;
      await tx.insert(schema.changeLog).values({
        entityType: "purchase_order", entityId: po.id, entityCode: po.code, type: "Update", field: "receipt", fieldLabel: "Receipt",
        fromValue: `Receipt ${before.masterId}`, toValue: "Cancelled",
        message: `Receipt ${before.masterId} is cancelled. ${units} of ${before.sku} reversed from ${before.locationCode}${before.lpNumber ? ` (LP ${before.lpNumber})` : ""}.`,
        userId: ctx.userId, source: ctx.source,
      });
      if ("receivedAt" in reopen && po.receivedAt) {
        await changeLog.recordUpdate(tx, ctx, { entityType: "purchase_order", entityId: po.id, entityCode: po.code,
          before: logSnapshot({ receivedAt: po.receivedAt }, await warehouseTimeZone(tx, po.warehouseId)), after: logSnapshot({ receivedAt: null }) });
      }
    }
    if (before.damageReason) {
      const lineId = (await tx.select({ lineId: r.purchaseOrderLineId }).from(r).where(eq(r.id, id)).limit(1))[0]?.lineId;
      if (lineId) {
        await tx.update(schema.purchaseOrderLines).set({ damagedQuantity: sql`max(0, ${schema.purchaseOrderLines.damagedQuantity} - ${before.quantity})` })
          .where(eq(schema.purchaseOrderLines.id, lineId));
      }
    }
  }
  return await getReceipt(tx, scope, id);
}

/** Receipts of one PO (detail page "Receipts" tab). */
export async function receiptsForPurchaseOrder(db: AppDb, scope: Scope, poId: string): Promise<ReceiptRow[]> {
  const rows = await db.select(SELECT).from(r).where(and(eq(r.purchaseOrderId, poId), scopedWhere(r, scope))).orderBy(asc(r.receivedAt), asc(r.masterId)) as Base[];
  return rows.map(shape);
}
