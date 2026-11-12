/**
 * Search provider "lps" (License Plates). Matches LP number and alternate barcode inside
 * the caller's warehouse/client scope (scopedWhere); M10 may replace it. LPs have no
 * detail route yet, so hits open the LP Numbers list searched for that number.
 */
import { and, eq, or, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { scopedWhere } from '@/server/auth/scope';
import { licensePlates, locations } from '@/server/db/schema';
import { COUNT_ALL, containsText, matchRank } from '../match';
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from '../types';

const LIST_PATH = '/settings/lp-numbers';

function where({ auth, q }: Pick<SearchContext, 'auth' | 'q'>): SQL {
  const text = or(
    containsText(licensePlates.number, q),
    containsText(licensePlates.alternateBarcode, q),
  ) as SQL;
  const scope = scopedWhere(licensePlates, auth.scope);
  return scope ? (and(text, scope) as SQL) : text;
}

export const provider: SearchProvider = {
  key: 'lps',
  label: 'License Plates',
  singular: 'License Plate',
  owner: 'foundation',
  configured: true,
  permission: 'settings.lp_numbers.view',
  seeAllHref: (q) => listSearchHref(LIST_PATH, q),
  count: async (ctx) =>
    (await ctx.db.select({ n: COUNT_ALL }).from(licensePlates).where(where(ctx)).limit(1))[0]?.n ?? 0,
  search: async (ctx) =>
    (
      await ctx.db
        .select({
          id: licensePlates.id,
          number: licensePlates.number,
          alternateBarcode: licensePlates.alternateBarcode,
          status: licensePlates.status,
          locationCode: locations.code,
        })
        .from(licensePlates)
        .leftJoin(locations, eq(locations.id, licensePlates.locationId))
        .where(where(ctx))
        .orderBy(matchRank(licensePlates.number, ctx.q), asc(licensePlates.number))
        .limit(ctx.limit)
    ).map((lp) => ({
      id: lp.id,
      title: lp.number,
      subtitle: `${lp.status} · ${lp.locationCode ?? 'No location'}`,
      href: listSearchHref(LIST_PATH, lp.number),
      rank: hitRank(ctx.q, [lp.number, lp.alternateBarcode]),
    })),
};
