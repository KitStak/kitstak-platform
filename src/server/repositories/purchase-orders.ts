import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { purchaseOrders, purchaseOrderLines, products, clients } = schema;

export type PurchaseOrderStatus = (typeof purchaseOrders.$inferSelect)["status"];

export const PO_STATUSES = [
  "Pending",
  "Started",
  "Receiving",
  "Completed",
  "Cancelled",
] as const;

export interface PurchaseOrderListParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: PurchaseOrderStatus;
  clientId?: string;
}

export interface PurchaseOrderListRow {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  vendorName: string;
  referenceNumber: string | null;
  status: PurchaseOrderStatus;
  poType: string;
  totalQuantity: number;
  receivedQuantity: number;
  purchasePrice: number;
  expectedDate: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export function listPurchaseOrders(
  params: PurchaseOrderListParams
): ListResult<PurchaseOrderListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.status) conds.push(eq(purchaseOrders.status, params.status));
  if (params.clientId) conds.push(eq(purchaseOrders.clientId, params.clientId));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(
      or(
        like(purchaseOrders.code, p),
        like(purchaseOrders.vendorName, p),
        like(purchaseOrders.referenceNumber, p)
      )
    );
  }
  const where = and(...conds);
  const rows = db
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      clientId: purchaseOrders.clientId,
      clientName: clients.name,
      vendorName: purchaseOrders.vendorName,
      referenceNumber: purchaseOrders.referenceNumber,
      status: purchaseOrders.status,
      poType: purchaseOrders.poType,
      totalQuantity: purchaseOrders.totalQuantity,
      receivedQuantity: purchaseOrders.receivedQuantity,
      purchasePrice: purchaseOrders.purchasePrice,
      expectedDate: purchaseOrders.expectedDate,
      receivedAt: purchaseOrders.receivedAt,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(clients, eq(purchaseOrders.clientId, clients.id))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(purchaseOrders).where(where).get()?.n ?? 0;
  return { rows, total };
}

/* ============ detail ============ */

export interface PurchaseOrderLineRow {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
}

export interface PurchaseOrderDetail {
  purchaseOrder: typeof purchaseOrders.$inferSelect & {
    clientName: string;
    clientCode: string;
  };
  lines: PurchaseOrderLineRow[];
}

export function getPurchaseOrderDetail(id: string): PurchaseOrderDetail | null {
  const row = db
    .select()
    .from(purchaseOrders)
    .innerJoin(clients, eq(purchaseOrders.clientId, clients.id))
    .where(eq(purchaseOrders.id, id))
    .get();
  if (!row) return null;
  const lines = db
    .select({
      id: purchaseOrderLines.id,
      productId: purchaseOrderLines.productId,
      sku: products.sku,
      productName: products.name,
      orderedQuantity: purchaseOrderLines.orderedQuantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
      unitCost: purchaseOrderLines.unitCost,
    })
    .from(purchaseOrderLines)
    .innerJoin(products, eq(purchaseOrderLines.productId, products.id))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .all();
  return {
    purchaseOrder: {
      ...row.purchase_orders,
      clientName: row.clients.name,
      clientCode: row.clients.code,
    },
    lines,
  };
}
