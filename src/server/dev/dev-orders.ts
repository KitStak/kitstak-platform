import { and, eq, inArray, type SQL } from "drizzle-orm";
import { asc, desc } from "@/server/db/order";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { clients, orderLines, products, shipmentOrders } from "@/server/db/schema";
import { DEV_GRID_ROW_LIMIT, type DevOrderLine, type DevOrderLines, type DevOrderRow } from "@/lib/dev-orders";
import { flatMapSeq } from "@/server/db/sql";

/** Latest seeded shipment orders inside the viewer's (context-narrowed) scope. */
export async function loadDevOrders(db: AppDb, scope: Scope): Promise<readonly DevOrderRow[]> {
  if (scope.warehouseIds.length === 0) return [];
  const conditions: SQL[] = [inArray(shipmentOrders.warehouseId, [...scope.warehouseIds])];
  if (scope.clientIds !== "all") {
    if (scope.clientIds.length === 0) return [];
    conditions.push(inArray(shipmentOrders.clientId, [...scope.clientIds]));
  }
  return await db
    .select({
      id: shipmentOrders.id,
      code: shipmentOrders.code,
      status: shipmentOrders.status,
      clientName: clients.name,
      channel: shipmentOrders.channel,
      storeOrderNumber: shipmentOrders.storeOrderNumber,
      customerName: shipmentOrders.customerName,
      shipState: shipmentOrders.shipState,
      priority: shipmentOrders.priority,
      totalQuantity: shipmentOrders.totalQuantity,
      salesPrice: shipmentOrders.salesPrice,
      orderDate: shipmentOrders.orderDate,
      trackingNumber: shipmentOrders.trackingNumber,
    })
    .from(shipmentOrders)
    .innerJoin(clients, eq(clients.id, shipmentOrders.clientId))
    .where(and(...conditions))
    .orderBy(desc(shipmentOrders.orderDate))
    .limit(DEV_GRID_ROW_LIMIT);
}

/** SQLite caps bound parameters; chunk the IN list well below it. */
const LINE_QUERY_CHUNK = 400;

/** Order lines (SKU, description, ordered / allocated / picked) for the given orders. */
export async function loadDevOrderLines(db: AppDb, orderIds: readonly string[]): Promise<DevOrderLines> {
  const chunks = Array.from({ length: Math.ceil(orderIds.length / LINE_QUERY_CHUNK) }, (_, i) => orderIds.slice(i * LINE_QUERY_CHUNK, (i + 1) * LINE_QUERY_CHUNK));
  const rows = await flatMapSeq(chunks, async (ids) =>
    await db
      .select({
        orderId: orderLines.orderId,
        id: orderLines.id,
        sku: products.sku,
        description: products.name,
        quantity: orderLines.quantity,
        allocatedQuantity: orderLines.allocatedQuantity,
        pickedQuantity: orderLines.pickedQuantity,
      })
      .from(orderLines)
      .innerJoin(products, eq(products.id, orderLines.productId))
      .where(inArray(orderLines.orderId, [...ids]))
      .orderBy(asc(products.sku)));
  const grouped = new Map<string, DevOrderLine[]>();
  for (const { orderId, ...line } of rows) grouped.set(orderId, [...(grouped.get(orderId) ?? []), line]);
  return Object.fromEntries(grouped);
}
