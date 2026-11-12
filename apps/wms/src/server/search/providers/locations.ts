/**
 * Search provider "locations" (Locations). Matches location code and barcode inside the
 * caller's warehouse scope (scopedWhere); M10 may replace it.
 */
import { and, eq, or, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { scopedWhere } from '@/server/auth/scope';
import { locations, warehouses } from '@/server/db/schema';
import { COUNT_ALL, containsText, matchRank } from '../match';
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from '../types';

function where({ auth, q }: Pick<SearchContext, 'auth' | 'q'>): SQL {
  const text = or(containsText(locations.code, q), containsText(locations.barcode, q)) as SQL;
  const scope = scopedWhere(locations, auth.scope);
  return scope ? (and(text, scope) as SQL) : text;
}

export const provider: SearchProvider = {
  key: 'locations',
  label: 'Locations',
  singular: 'Location',
  owner: 'foundation',
  configured: true,
  permission: 'settings.locations.view',
  seeAllHref: (q) => listSearchHref('/locations', q),
  count: async (ctx) =>
    (await ctx.db.select({ n: COUNT_ALL }).from(locations).where(where(ctx)).limit(1))[0]?.n ?? 0,
  search: async (ctx) =>
    (
      await ctx.db
        .select({
          id: locations.id,
          code: locations.code,
          barcode: locations.barcode,
          zone: locations.zone,
          type: locations.type,
          locationType: locations.locationType,
          warehouseCode: warehouses.code,
        })
        .from(locations)
        .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
        .where(where(ctx))
        .orderBy(matchRank(locations.code, ctx.q), asc(locations.code))
        .limit(ctx.limit)
    ).map((l) => ({
      id: l.id,
      title: l.code,
      subtitle: `${l.warehouseCode} · Zone ${l.zone} · ${l.locationType ?? l.type}`,
      href: `/locations/${l.id}`,
      rank: hitRank(ctx.q, [l.code, l.barcode]),
    })),
};
