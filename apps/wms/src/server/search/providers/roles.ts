/**
 * Search provider "roles" (Roles). Matches role name, key and description; needs
 * `settings.roles.view`. Opens the role drawer through `/settings/roles?id=`. Owner: M14.
 */
import { or, type SQL } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { roles } from '@/server/db/schema';
import { COUNT_ALL, containsText, matchRank } from '../match';
import { hitRank, listSearchHref, type SearchContext, type SearchProvider } from '../types';

function where({ q }: Pick<SearchContext, 'q'>): SQL {
  return or(
    containsText(roles.name, q),
    containsText(roles.key, q),
    containsText(roles.description, q),
  ) as SQL;
}

export const provider: SearchProvider = {
  key: 'roles',
  label: 'Roles',
  singular: 'Role',
  owner: 'M14',
  configured: true,
  permission: 'settings.roles.view',
  seeAllHref: (q) => listSearchHref('/settings/roles', q),
  count: async (ctx) =>
    (await ctx.db.select({ n: COUNT_ALL }).from(roles).where(where(ctx)).limit(1))[0]?.n ?? 0,
  search: async (ctx) =>
    (
      await ctx.db
        .select({ id: roles.id, name: roles.name, category: roles.category, isSystem: roles.isSystem })
        .from(roles)
        .where(where(ctx))
        .orderBy(matchRank(roles.name, ctx.q), asc(roles.name))
        .limit(ctx.limit)
    ).map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: [r.category, r.isSystem ? 'System role' : 'Custom role'].join(' · '),
      href: `/settings/roles?id=${encodeURIComponent(r.id)}`,
      rank: hitRank(ctx.q, [r.name]),
    })),
};
