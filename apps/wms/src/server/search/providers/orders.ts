/**
 * Search provider "orders" (Shipment Orders) — owned by M01. Matches order code, store
 * order number, tracking numbers (order, multi-package list and shipment labels) and
 * customer / client name inside the caller's scope. Soft-deleted orders never match.
 */
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import { scopedWhere } from '@/server/auth/scope';
import { clients, shipmentOrders } from '@/server/db/schema';
import { COUNT_ALL, containsText, escapeLike, matchRank } from '../match';
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from '../types';

const BACKSLASH = '\\';

function trackingMatch(q: string): SQL {
  const pattern = `%${escapeLike(q)}%`;
  return sql`((${shipmentOrders.trackingNumbers})::text ILIKE ${pattern} ESCAPE ${BACKSLASH} OR EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = "shipment_orders"."id" AND s.tracking_number ILIKE ${pattern} ESCAPE ${BACKSLASH}))`;
}

function where({ auth, q }: Pick<SearchContext, 'auth' | 'q'>): SQL {
  const text = or(
    containsText(shipmentOrders.code, q),
    containsText(shipmentOrders.storeOrderNumber, q),
    containsText(shipmentOrders.trackingNumber, q),
    trackingMatch(q),
    containsText(shipmentOrders.customerName, q),
    containsText(clients.name, q),
  ) as SQL;
  return and(text, isNull(shipmentOrders.deletedAt), scopedWhere(shipmentOrders, auth.scope)) as SQL;
}

export const provider: SearchProvider = {
  key: 'orders',
  label: 'Orders',
  singular: 'Order',
  owner: 'M01',
  configured: true,
  permission: 'fulfillment.shipment_orders.view',
  seeAllHref: (q) => listSearchHref('/orders', q),
  count: async (ctx) =>
    (
      await ctx.db
        .select({ n: COUNT_ALL })
        .from(shipmentOrders)
        .innerJoin(clients, eq(clients.id, shipmentOrders.clientId))
        .where(where(ctx))
        .limit(1)
    )[0]?.n ?? 0,
  search: async (ctx) =>
    (
      await ctx.db
        .select({
          id: shipmentOrders.id,
          code: shipmentOrders.code,
          storeOrderNumber: shipmentOrders.storeOrderNumber,
          status: shipmentOrders.status,
          customerName: shipmentOrders.customerName,
          clientName: clients.name,
          trackingNumber: shipmentOrders.trackingNumber,
        })
        .from(shipmentOrders)
        .innerJoin(clients, eq(clients.id, shipmentOrders.clientId))
        .where(where(ctx))
        .orderBy(matchRank(shipmentOrders.code, ctx.q), desc(shipmentOrders.orderDate))
        .limit(ctx.limit)
    ).map((o) => {
      const byTracking = Boolean(o.trackingNumber?.toLowerCase().includes(ctx.q.toLowerCase()));
      return {
        id: o.id,
        title: o.code,
        subtitle: byTracking
          ? `Tracking ${o.trackingNumber} · ${o.customerName}`
          : `${o.customerName} · ${o.clientName}`,
        status: { label: o.status, domain: 'shipmentOrder' as const },
        href: `/orders/${encodeURIComponent(o.code)}`,
        rank: hitRank(ctx.q, [o.code, o.storeOrderNumber, o.trackingNumber]),
      };
    }),
};
