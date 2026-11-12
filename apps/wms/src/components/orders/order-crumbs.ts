import type { Crumb } from "@/components/layout/breadcrumbs";

/**
 * Breadcrumbs for every outbound order page, matching the nav tree and Return Orders:
 * Home › Fulfillment › Outbound › … (Home is added by the shared Breadcrumbs).
 */
export const OUTBOUND_ROOT: readonly Crumb[] = [{ label: "Fulfillment" }, { label: "Outbound" }];

export function orderCrumbs(...rest: readonly (Crumb | string)[]): readonly Crumb[] {
  return [...OUTBOUND_ROOT, ...rest.map((c) => (typeof c === "string" ? { label: c } : c))];
}

/** List a detail page belongs to (closed orders live on Shipped & Canceled). */
export function orderListCrumb(status: string): Crumb {
  return ["Shipped", "Delivered", "Cancelled"].includes(status)
    ? { label: "Shipped & Canceled Orders", href: "/orders/shipped" }
    : { label: "Shipment Orders", href: "/orders" };
}
