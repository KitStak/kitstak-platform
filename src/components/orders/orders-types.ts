/**
 * Client-safe types & constants for the Shipment Orders list.
 * Mirrors `OrderListRow` from src/server/repositories/orders.ts — kept separate
 * so client components never import the server/db module graph.
 */

export type OrdersTab = "backlog" | "shipped" | "returns";

export interface OrderRow {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  channel: string;
  storeName: string | null;
  storeOrderNumber: string | null;
  customerName: string;
  shipCity: string;
  shipState: string;
  shipCountry: string;
  status: string;
  orderType: string;
  priority: string;
  carrier: string | null;
  shippingService: string | null;
  trackingNumber: string | null;
  totalQuantity: number;
  firstSku: string | null;
  skuCount: number;
  salesPrice: number;
  orderDate: string;
  expectedShipDate: string | null;
  shippedAt: string | null;
  note: string | null;
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface OrdersApiMeta {
  total: number;
  page: number;
  pageSize: number;
}

export interface OrdersApiResponse {
  success: boolean;
  data?: OrderRow[];
  error?: string;
  meta?: OrdersApiMeta;
}

export interface ClientsApiResponse {
  success: boolean;
  data?: ClientOption[];
  error?: string;
}

export const ORDER_TABS: ReadonlyArray<{ key: OrdersTab; label: string }> = [
  { key: "backlog", label: "Order Backlog" },
  { key: "shipped", label: "Shipped & Canceled Orders" },
  { key: "returns", label: "Return Orders" },
];

/** Status filter options, scoped to what each tab can actually contain. */
export const TAB_STATUS_OPTIONS: Record<OrdersTab, readonly string[]> = {
  backlog: [
    "Open",
    "Ready to Pick",
    "Picking Started",
    "Ready to Pack",
    "Packing Started",
    "Ready to Ship",
    "Shortage",
    "On Hold",
  ],
  shipped: ["Shipped", "Delivered", "Cancelled"],
  returns: ["Delivered"],
};

export const CHANNEL_OPTIONS: readonly string[] = [
  "Shopify",
  "Amazon",
  "TikTok Shop",
  "Walmart",
  "Wholesale",
  "Manual",
];

export const TAB_EMPTY_STATES: Record<
  OrdersTab,
  { title: string; description: string }
> = {
  backlog: {
    title: "No orders in the backlog",
    description:
      "All caught up. New orders from your connected stores will land here — or adjust your search and filters.",
  },
  shipped: {
    title: "No shipped or canceled orders",
    description:
      "Orders move here once they ship or are canceled. Try widening your search or clearing filters.",
  },
  returns: {
    title: "No return orders",
    description:
      "Customer returns (RMAs) will appear here once a return is initiated against a delivered order.",
  },
};
