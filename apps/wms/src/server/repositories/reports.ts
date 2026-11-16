import { eq, gt, isNotNull } from 'drizzle-orm';
import { schema } from '@/server/db';
import { getAppDb } from '@/server/api/db';
import { listTotalInventory, type InventoryListParams, type TotalInventoryRow } from './inventory';
import { offsetOf, type ListResult } from './shared';

const { shipmentOrders, purchaseOrders, clients } = schema;

/* ============ inventory snapshot ============ */

export type InventorySnapshotRow = TotalInventoryRow;

/** Per-product snapshot across all locations (onHand / allocated / available / damaged). */
export async function getInventorySnapshot(
  params: InventoryListParams,
): Promise<ListResult<InventorySnapshotRow>> {
  return await listTotalInventory(params);
}

/* ============ transaction history ============ */

export type TransactionType = 'Shipment' | 'Receipt';

export interface TransactionRow {
  id: string;
  date: string;
  type: TransactionType;
  reference: string;
  clientName: string;
  quantity: number;
  detail: string;
}

export interface TransactionHistoryParams {
  page: number;
  pageSize: number;
  search?: string;
  type?: TransactionType;
}

/**
 * Transaction history synthesized from shipped orders (outbound) and
 * purchase-order receipts (inbound). Small dataset, so the union is
 * merged and paginated in memory.
 */
export async function getTransactionHistory(
  params: TransactionHistoryParams,
): Promise<ListResult<TransactionRow>> {
  const db = await getAppDb();
  const shipments: TransactionRow[] = (
    await db
      .select({
        id: shipmentOrders.id,
        date: shipmentOrders.shippedAt,
        reference: shipmentOrders.code,
        clientName: clients.name,
        quantity: shipmentOrders.totalQuantity,
        carrier: shipmentOrders.carrier,
        service: shipmentOrders.shippingService,
      })
      .from(shipmentOrders)
      .innerJoin(clients, eq(shipmentOrders.clientId, clients.id))
      .where(isNotNull(shipmentOrders.shippedAt))
  ).map((r) => ({
    id: `txn-ship-${r.id}`,
    date: r.date ?? '',
    type: 'Shipment' as const,
    reference: r.reference,
    clientName: r.clientName,
    quantity: r.quantity,
    detail: r.service ?? r.carrier ?? 'Shipped',
  }));

  const receipts: TransactionRow[] = (
    await db
      .select({
        id: purchaseOrders.id,
        receivedAt: purchaseOrders.receivedAt,
        expectedDate: purchaseOrders.expectedDate,
        createdAt: purchaseOrders.createdAt,
        reference: purchaseOrders.code,
        clientName: clients.name,
        quantity: purchaseOrders.receivedQuantity,
        vendorName: purchaseOrders.vendorName,
      })
      .from(purchaseOrders)
      .innerJoin(clients, eq(purchaseOrders.clientId, clients.id))
      .where(gt(purchaseOrders.receivedQuantity, 0))
  ).map((r) => ({
    id: `txn-recv-${r.id}`,
    date: r.receivedAt ?? r.expectedDate ?? r.createdAt,
    type: 'Receipt' as const,
    reference: r.reference,
    clientName: r.clientName,
    quantity: r.quantity,
    detail: `Received from ${r.vendorName}`,
  }));

  const needle = params.search?.trim().toLowerCase();
  const merged = [...shipments, ...receipts]
    .filter((t) => (params.type ? t.type === params.type : true))
    .filter((t) =>
      needle
        ? t.reference.toLowerCase().includes(needle) ||
          t.clientName.toLowerCase().includes(needle) ||
          t.detail.toLowerCase().includes(needle)
        : true,
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const start = offsetOf(params.page, params.pageSize);
  return {
    rows: merged.slice(start, start + params.pageSize),
    total: merged.length,
  };
}
