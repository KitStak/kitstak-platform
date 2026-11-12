/**
 * Search provider "pos" (Purchase Orders). Matches PO code, reference number and vendor
 * inside the caller's warehouse/client scope (scopedWhere). Owner: M05.
 */
import { and, eq, or, type SQL } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import { scopedWhere } from '@/server/auth/scope';
import { clients, purchaseOrders } from '@/server/db/schema';
import { displayPoStatus } from '@/lib/grid-defs/receiving/purchase-orders';
import { COUNT_ALL, containsText, matchRank } from '../match';
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from '../types';

function where({ auth, q }: Pick<SearchContext, 'auth' | 'q'>): SQL {
  const text = or(
    containsText(purchaseOrders.code, q),
    containsText(purchaseOrders.referenceNumber, q),
    containsText(purchaseOrders.vendorName, q),
  ) as SQL;
  const scope = scopedWhere(purchaseOrders, auth.scope);
  return scope ? (and(text, scope) as SQL) : text;
}

export const provider: SearchProvider = {
  key: 'pos',
  label: 'Purchase Orders',
  singular: 'Purchase Order',
  owner: 'M05',
  configured: true,
  permission: 'inventory.purchase_orders.view',
  seeAllHref: (q) => listSearchHref('/receiving', q),
  count: async (ctx) =>
    (await ctx.db.select({ n: COUNT_ALL }).from(purchaseOrders).where(where(ctx)).limit(1))[0]?.n ?? 0,
  search: async (ctx) =>
    (
      await ctx.db
        .select({
          id: purchaseOrders.id,
          code: purchaseOrders.code,
          referenceNumber: purchaseOrders.referenceNumber,
          status: purchaseOrders.status,
          vendorName: purchaseOrders.vendorName,
          clientName: clients.name,
        })
        .from(purchaseOrders)
        .innerJoin(clients, eq(clients.id, purchaseOrders.clientId))
        .where(where(ctx))
        .orderBy(matchRank(purchaseOrders.code, ctx.q), desc(purchaseOrders.code))
        .limit(ctx.limit)
    ).map((p) => ({
      id: p.id,
      title: p.code,
      subtitle: [p.vendorName, p.referenceNumber ? `Ref ${p.referenceNumber}` : null, p.clientName]
        .filter(Boolean)
        .join(' · '),
      status: { label: displayPoStatus(p.status), domain: 'purchaseOrder' },
      href: `/receiving/${p.id}`,
      rank: hitRank(ctx.q, [p.code, p.referenceNumber]),
    })),
};
