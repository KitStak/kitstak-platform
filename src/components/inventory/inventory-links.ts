/**
 * Cross-module deep links (grid grammar, BUILD_PLAN 0.2).
 * - Products grid filters clients on `f.clientId`.
 * - Open SO links go through `/api/inventory/open-orders`, which redirects to the
 *   Orders grid filtered to exactly the open orders (`f.code=in:`) — the Orders SKU
 *   filter alone would miss multi-line orders.
 */
import type { GridFilter } from "@/server/query/grid-query";

export function productFilters(sku: string, clientId: string | null): GridFilter[] {
  const out: GridFilter[] = [{ field: "sku", op: "eq", value: sku }];
  if (clientId) out.push({ field: "clientId", op: "in", values: [clientId] });
  return out;
}

export function openOrdersHref(productId: string, warehouseId: string | null): string {
  const qs = new URLSearchParams({ productId });
  if (warehouseId) qs.set("warehouseId", warehouseId);
  return `/api/inventory/open-orders?${qs.toString()}`;
}
