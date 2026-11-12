/** Global search contracts (BUILD_PLAN F6 `search/`, F7 `GET /api/search`). */
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import type { StatusDomain } from '@/lib/status-colors';

export interface SearchContext {
  readonly db: AppDb;
  readonly auth: AuthContext;
  /** Trimmed query, 2..100 chars. */
  readonly q: string;
  /** Max hits this provider should return. */
  readonly limit: number;
}

export interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Record status, rendered as a small StatusPill before the subtitle (keep it out of `subtitle`). */
  readonly status?: { readonly label: string; readonly domain: StatusDomain };
  /** Deep link (record detail or page route). */
  readonly href: string;
  /** Match quality: 0 exact, 1 prefix, 2 contains, 3 matched another field (lower first). */
  readonly rank?: number;
}

export interface SearchProvider {
  readonly key: string;
  /** Group heading in the command palette ("Orders", "Pages"). */
  readonly label: string;
  /** Per-row type label ("Order"). Defaults to `label`. */
  readonly singular?: string;
  /** List page that shows every match ("See all N orders →"), e.g. `/orders?q=…`. */
  readonly seeAllHref?: (q: string) => string;
  /** Total matches in scope (for the "See all N" footer); defaults to the hit count. */
  count?(ctx: SearchContext): number | Promise<number>;
  /** Owning module (0.6) or "foundation". */
  readonly owner: string;
  /** False for a 0.6 stub: skipped by `globalSearch`. */
  readonly configured: boolean;
  /** Any-of permission needed to see this group; null = every signed-in user. */
  readonly permission: string | readonly string[] | null;
  search(ctx: SearchContext): readonly SearchHit[] | Promise<readonly SearchHit[]>;
}

export function createStubSearchProvider(
  key: string,
  label: string,
  owner: string,
  permission: string,
): SearchProvider {
  return { key, label, owner, configured: false, permission, search: () => [] };
}

export const RANK_EXACT = 0;
export const RANK_PREFIX = 1;
export const RANK_CONTAINS = 2;
export const RANK_OTHER_FIELD = 3;

/**
 * Rank of a hit for `q`: best of its primary fields (exact > prefix > contains), else
 * RANK_OTHER_FIELD (it matched a secondary field such as customer or client name).
 */
export function hitRank(q: string, primary: readonly (string | null | undefined)[]): number {
  const needle = q.trim().toLowerCase();
  let best = RANK_OTHER_FIELD;
  for (const value of primary) {
    const hay = value?.trim().toLowerCase();
    if (!hay || !needle) continue;
    if (hay === needle) return RANK_EXACT;
    if (hay.startsWith(needle)) best = Math.min(best, RANK_PREFIX);
    else if (hay.includes(needle)) best = Math.min(best, RANK_CONTAINS);
  }
  return best;
}

/** "List?q=" link for a "See all" footer. */
export function listSearchHref(path: string, q: string): string {
  return `${path}?${new URLSearchParams({ q }).toString()}`;
}
