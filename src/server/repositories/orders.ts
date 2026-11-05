import { and, count, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { shipmentOrders, orderLines, products, clients } = schema;

export type OrderStatus = (typeof shipmentOrders.$inferSelect)["status"];
export type OrderChannel = (typeof shipmentOrders.$inferSelect)["channel"];
export type OrderTab = "backlog" | "shipped" | "returns";

export const ORDER_STATUSES = [
  "Open",
  "Ready to Pick",
  "Picking Started",
  "Ready to Pack",
  "Packing Started",
  "Ready to Ship",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Shortage",
  "On Hold",
] as const;

export const ORDER_CHANNELS = [
  "Shopify",
  "Amazon",
  "TikTok Shop",
  "Walmart",
  "Wholesale",
  "Manual",
] as const;

export const BACKLOG_STATUSES: readonly OrderStatus[] = [
  "Open",
  "Ready to Pick",
  "Picking Started",
  "Ready to Pack",
  "Packing Started",
  "Ready to Ship",
  "Shortage",
  "On Hold",
];

const SHIPPED_STATUSES: readonly OrderStatus[] = ["Shipped", "Delivered", "Cancelled"];

export interface OrderListParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: OrderStatus;
  channel?: OrderChannel;
  clientId?: string;
  tab?: OrderTab;
}

export interface OrderListRow {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  channel: OrderChannel;
  storeName: string | null;
  storeOrderNumber: string | null;
  customerName: string;
  shipCity: string;
  shipState: string;
  shipCountry: string;
  status: OrderStatus;
  orderType: string;
  priority: string;
  carrier: string | null;
  shippingService: string | null;
  trackingNumber: string | null;
  totalQuantity: number;
  /** Lowest SKU among the order's lines (display preview); null when no lines. */
  firstSku: string | null;
  /** Distinct order-line count (one line per SKU). */
  skuCount: number;
  salesPrice: number;
  orderDate: string;
  expectedShipDate: string | null;
  shippedAt: string | null;
  note: string | null;
}

function orderConditions(params: OrderListParams): SQL | undefined {
  const conds: Array<SQL | undefined> = [];
  if (params.tab === "backlog") {
    conds.push(inArray(shipmentOrders.status, [...BACKLOG_STATUSES]));
  } else if (params.tab === "shipped") {
    conds.push(inArray(shipmentOrders.status, [...SHIPPED_STATUSES]));
  } else if (params.tab === "returns") {
    conds.push(eq(shipmentOrders.status, "Delivered"));
    conds.push(like(shipmentOrders.note, "RMA-%"));
  }
  if (params.status) conds.push(eq(shipmentOrders.status, params.status));
  if (params.channel) conds.push(eq(shipmentOrders.channel, params.channel));
  if (params.clientId) conds.push(eq(shipmentOrders.clientId, params.clientId));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(
      or(
        like(shipmentOrders.code, p),
        like(shipmentOrders.customerName, p),
        like(shipmentOrders.storeOrderNumber, p),
        like(shipmentOrders.trackingNumber, p)
      )
    );
  }
  return and(...conds);
}

export function listOrders(params: OrderListParams): ListResult<OrderListRow> {
  const where = orderConditions(params);
  const lineAgg = db
    .select({
      orderId: orderLines.orderId,
      skuCount: count().as("sku_count"),
      firstSku: sql<string>`min(${products.sku})`.as("first_sku"),
    })
    .from(orderLines)
    .innerJoin(products, eq(orderLines.productId, products.id))
    .groupBy(orderLines.orderId)
    .as("line_agg");
  const rows = db
    .select({
      id: shipmentOrders.id,
      code: shipmentOrders.code,
      clientId: shipmentOrders.clientId,
      clientName: clients.name,
      channel: shipmentOrders.channel,
      storeName: shipmentOrders.storeName,
      storeOrderNumber: shipmentOrders.storeOrderNumber,
      customerName: shipmentOrders.customerName,
      shipCity: shipmentOrders.shipCity,
      shipState: shipmentOrders.shipState,
      shipCountry: shipmentOrders.shipCountry,
      status: shipmentOrders.status,
      orderType: shipmentOrders.orderType,
      priority: shipmentOrders.priority,
      carrier: shipmentOrders.carrier,
      shippingService: shipmentOrders.shippingService,
      trackingNumber: shipmentOrders.trackingNumber,
      totalQuantity: shipmentOrders.totalQuantity,
      firstSku: sql<string | null>`${lineAgg.firstSku}`,
      skuCount: sql<number>`coalesce(${lineAgg.skuCount}, 0)`,
      salesPrice: shipmentOrders.salesPrice,
      orderDate: shipmentOrders.orderDate,
      expectedShipDate: shipmentOrders.expectedShipDate,
      shippedAt: shipmentOrders.shippedAt,
      note: shipmentOrders.note,
    })
    .from(shipmentOrders)
    .innerJoin(clients, eq(shipmentOrders.clientId, clients.id))
    .leftJoin(lineAgg, eq(lineAgg.orderId, shipmentOrders.id))
    .where(where)
    .orderBy(desc(shipmentOrders.orderDate))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total =
    db.select({ n: count() }).from(shipmentOrders).where(where).get()?.n ?? 0;
  return { rows, total };
}

/* ============ detail ============ */

export interface OrderDetailLine {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  pickedQuantity: number;
  packedQuantity: number;
  unitPrice: number;
}

export interface TimelineEvent {
  label: string;
  at: string | null;
  done: boolean;
}

export type OrderDetailHeader = typeof shipmentOrders.$inferSelect & {
  clientName: string;
  clientCode: string;
};

export interface OrderDetail {
  order: OrderDetailHeader;
  lines: OrderDetailLine[];
  timeline: TimelineEvent[];
}

const STAGE_LABELS: ReadonlyArray<readonly [OrderStatus, string]> = [
  ["Open", "Order created"],
  ["Ready to Pick", "Ready to pick"],
  ["Picking Started", "Picking started"],
  ["Ready to Pack", "Ready to pack"],
  ["Packing Started", "Packing started"],
  ["Ready to Ship", "Ready to ship"],
  ["Shipped", "Shipped"],
  ["Delivered", "Delivered"],
];

function interpolateIso(startIso: string, endIso: string, fraction: number): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return new Date(Math.round(start + (end - start) * fraction)).toISOString();
}

function buildTimeline(order: typeof shipmentOrders.$inferSelect): TimelineEvent[] {
  const terminal = ["Cancelled", "On Hold", "Shortage"].includes(order.status);
  if (terminal) {
    return [
      { label: "Order created", at: order.createdAt, done: true },
      {
        label:
          order.status === "Cancelled"
            ? "Order cancelled"
            : order.status === "On Hold"
              ? "Placed on hold"
              : "Shortage flagged",
        at: interpolateIso(order.createdAt, order.createdAt, 0),
        done: true,
      },
    ];
  }
  const currentIdx = STAGE_LABELS.findIndex(([status]) => status === order.status);
  const endIso =
    order.shippedAt ??
    new Date(new Date(order.createdAt).getTime() + 20 * 3_600_000).toISOString();
  return STAGE_LABELS.map(([, label], idx) => {
    const done = idx <= currentIdx;
    let at: string | null = null;
    if (done) {
      if (idx === 0) at = order.createdAt;
      else if (idx === 6) at = order.shippedAt;
      else if (idx === 7) at = order.deliveredAt;
      else at = interpolateIso(order.createdAt, endIso, idx / 6);
    }
    return { label, at, done };
  });
}

export function getOrderDetail(id: string): OrderDetail | null {
  const row = db
    .select()
    .from(shipmentOrders)
    .innerJoin(clients, eq(shipmentOrders.clientId, clients.id))
    .where(eq(shipmentOrders.id, id))
    .get();
  if (!row) return null;
  const order = row.shipment_orders;
  const lines = db
    .select({
      id: orderLines.id,
      productId: orderLines.productId,
      sku: products.sku,
      productName: products.name,
      quantity: orderLines.quantity,
      pickedQuantity: orderLines.pickedQuantity,
      packedQuantity: orderLines.packedQuantity,
      unitPrice: orderLines.unitPrice,
    })
    .from(orderLines)
    .innerJoin(products, eq(orderLines.productId, products.id))
    .where(eq(orderLines.orderId, id))
    .all();
  return {
    order: { ...order, clientName: row.clients.name, clientCode: row.clients.code },
    lines,
    timeline: buildTimeline(order),
  };
}
