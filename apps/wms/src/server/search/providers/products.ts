/**
 * Search provider "products" (Products / SKUs), owner M09. Matches SKU, primary barcode,
 * any pack-type barcode, FNSKU and name inside the caller's client scope.
 */
import { PRODUCT_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { scopedWhere } from '@/server/auth/scope';
import { clients, products } from '@/server/db/schema';
import { COUNT_ALL, containsText, matchRank } from '../match';
import { hitRank, listSearchHref, RANK_CONTAINS, type SearchContext, type SearchProvider } from '../types';

function where({ auth, q }: Pick<SearchContext, 'auth' | 'q'>): SQL {
  const packBarcode = sql`EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.product_id = ${products.id} AND lower(pb.barcode) = lower(${q.trim()}))`;
  const text = or(
    containsText(products.sku, q),
    containsText(products.barcode, q),
    containsText(products.name, q),
    containsText(products.fnsku, q),
    packBarcode,
  ) as SQL;
  const scope = scopedWhere(products, auth.scope, { clientId: products.clientId });
  return scope ? (and(text, scope) as SQL) : text;
}

/**
 * SKU / barcode are the product's identity; a name hit (e.g. every "Apex Threads …" SKU
 * for "apex") ranks below an entity whose own name or code matches.
 */
function productRank(q: string, sku: string, barcode: string | null, name: string): number {
  const byIdentity = hitRank(q, [sku, barcode]);
  return name.toLowerCase().includes(q.trim().toLowerCase())
    ? Math.min(byIdentity, RANK_CONTAINS)
    : byIdentity;
}

export const provider: SearchProvider = {
  key: 'products',
  label: 'Products',
  singular: 'Product',
  owner: 'M09',
  configured: true,
  permission: PRODUCT_READ_PERMISSIONS,
  seeAllHref: (q) => listSearchHref('/products', q),
  count: async (ctx) =>
    (
      await ctx.db
        .select({ n: COUNT_ALL })
        .from(products)
        .innerJoin(clients, eq(clients.id, products.clientId))
        .where(where(ctx))
        .limit(1)
    )[0]?.n ?? 0,
  search: async (ctx) =>
    (
      await ctx.db
        .select({
          id: products.id,
          sku: products.sku,
          barcode: products.barcode,
          name: products.name,
          status: products.status,
          clientName: clients.name,
        })
        .from(products)
        .innerJoin(clients, eq(clients.id, products.clientId))
        .where(where(ctx))
        .orderBy(matchRank(products.sku, ctx.q), asc(products.sku))
        .limit(ctx.limit)
    ).map((p) => ({
      id: p.id,
      title: p.sku,
      subtitle: `${p.name} · ${p.clientName}`,
      status: { label: p.status, domain: 'active' },
      href: `/products/${p.id}`,
      rank: productRank(ctx.q, p.sku, p.barcode, p.name),
    })),
};
