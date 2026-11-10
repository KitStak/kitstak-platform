/**
 * "Open SO Qty" deep link (spec 04 §1, acceptance "Open SO opens Orders pre-filtered to
 * exactly those orders"). The Orders grid's SKU filter compares against the
 * concatenated SKU list of an order, so `f.sku=eq:X` would miss multi-line orders.
 * Instead we resolve the exact open orders that carry the product here and hand the
 * Orders grid an `f.code=in:` list.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { OPEN_SO_STATUSES } from "@/server/domain/atp";
import { serializeGridQuery } from "@/server/query/grid-query";
import { clientIn, inList } from "./inventory-grid";

/** URL length guard: beyond this many orders we fall back to a SKU filter. */
export const MAX_LINKED_ORDERS = 400;
const SHIPPED_TAB_STATUSES = new Set(["Partially Shipped"]);

export interface OpenOrderRef {
  readonly code: string;
  readonly status: string;
}

export function openOrdersFor(db: AppDb, auth: AuthContext, input: { productId: string; warehouseId?: string | null }): OpenOrderRef[] {
  const statuses: SQL = sql.join(OPEN_SO_STATUSES.map((s) => sql`${s}`), sql`, `);
  const wh = input.warehouseId ? inList(sql`o.warehouse_id`, auth.scope.warehouseIds.filter((w) => w === input.warehouseId)) : inList(sql`o.warehouse_id`, auth.viewScope.warehouseIds);
  return db.all<OpenOrderRef>(sql`
    SELECT DISTINCT o.code AS "code", o.status AS "status"
    FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id
    WHERE l.product_id = ${input.productId}
      AND o.deleted_at IS NULL AND o.status IN (${statuses})
      AND (l.quantity - l.cancelled_quantity - l.shipped_quantity) > 0
      AND ${wh} AND ${clientIn(sql`o.client_id`, auth.scope.clientIds)}
    ORDER BY o.code`);
}

/** Orders list URL showing exactly `orders` (backlog tab unless every one is partially shipped). */
export function openOrdersHref(orders: readonly OpenOrderRef[], fallback: { sku: string; warehouseId?: string | null }): string {
  const onlyShippedTab = orders.length > 0 && orders.every((o) => SHIPPED_TAB_STATUSES.has(o.status));
  const path = onlyShippedTab ? "/orders/shipped" : "/orders";
  if (orders.length === 0 || orders.length > MAX_LINKED_ORDERS) {
    const filters = [
      { field: "sku", op: "ct" as const, value: fallback.sku },
      ...(fallback.warehouseId ? [{ field: "warehouseId", op: "in" as const, values: [fallback.warehouseId] }] : []),
    ];
    return `${path}?${serializeGridQuery({ filters })}`;
  }
  return `${path}?${serializeGridQuery({ filters: [{ field: "code", op: "in", values: orders.map((o) => o.code) }] })}`;
}
