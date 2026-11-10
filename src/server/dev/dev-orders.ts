import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { clients, orderLines, products, shipmentOrders } from "@/server/db/schema";
import { DEV_GRID_ROW_LIMIT, type DevOrderLine, type DevOrderLines, type DevOrderRow } from "@/lib/dev-orders";

/** Latest seeded shipment orders inside the viewer's (context-narrowed) scope. */
export function loadDevOrders(db: AppDb, scope: Scope): readonly DevOrderRow[] {
  if (scope.warehouseIds.length === 0) return [];
  const conditions: SQL[] = [inArray(shipmentOrders.warehouseId, [...scope.warehouseIds])];
  if (scope.clientIds !== "all") {
    if (scope.clientIds.length === 0) return [];
    conditions.push(inArray(shipmentOrders.clientId, [...scope.clientIds]));
  }
  return db
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
    .limit(DEV_GRID_ROW_LIMIT)
    .all();
}

/** SQLite caps bound parameters; chunk the IN list well below it. */
const LINE_QUERY_CHUNK = 400;

/** Order lines (SKU, description, ordered / allocated / picked) for the given orders. */
export function loadDevOrderLines(db: AppDb, orderIds: readonly string[]): DevOrderLines {
  const chunks = Array.from({ length: Math.ceil(orderIds.length / LINE_QUERY_CHUNK) }, (_, i) => orderIds.slice(i * LINE_QUERY_CHUNK, (i + 1) * LINE_QUERY_CHUNK));
  const rows = chunks.flatMap((ids) =>
    db
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
      .orderBy(asc(products.sku))
      .all()
  );
  const grouped = new Map<string, DevOrderLine[]>();
  for (const { orderId, ...line } of rows) grouped.set(orderId, [...(grouped.get(orderId) ?? []), line]);
  return Object.fromEntries(grouped);
}
