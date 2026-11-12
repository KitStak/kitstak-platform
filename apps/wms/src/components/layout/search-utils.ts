/**
 * Pure helpers for global search: the client-side Pages group (instant, permission-aware)
 * and match highlighting, plus recent-search persistence.
 */
import { z } from 'zod';
import type { NavItem, NavMenu } from '@/config/nav-config';

export interface PageHit {
  readonly label: string;
  readonly href: string;
  /** "Fulfillment › Outbound" */
  readonly trail: string;
}

export interface HighlightPart {
  readonly text: string;
  readonly match: boolean;
}

export const MIN_RECORD_QUERY = 2;
export const MAX_PAGE_HITS = 12;
export const RECENT_SEARCH_LIMIT = 6;
export const RECENT_SEARCH_KEY = 'ks:recent-searches';

/** Flattens dashboard + menus + extra items into unique page entries (first href wins). */
export function flattenPages(
  menus: readonly NavMenu[],
  extra: readonly NavItem[],
): readonly (PageHit & { readonly aliases: readonly string[] })[] {
  const seen = new Set<string>();
  const out: (PageHit & { aliases: readonly string[] })[] = [];
  const push = (navItem: NavItem, trail: string): void => {
    if (seen.has(navItem.href)) return;
    seen.add(navItem.href);
    out.push({ label: navItem.label, href: navItem.href, trail, aliases: navItem.aliases ?? [] });
  };
  for (const menu of menus) {
    for (const column of menu.columns)
      column.items.forEach((navItem) => push(navItem, `${menu.label} › ${column.heading}`));
    if (menu.footer) push(menu.footer, menu.label);
  }
  extra.forEach((navItem) => push(navItem, 'Account'));
  return out;
}

/** 3 = title starts with the query, 2 = title contains it, 1 = alias match, 0 = none. */
function pageScore(page: PageHit & { readonly aliases: readonly string[] }, needle: string): number {
  const label = page.label.toLowerCase();
  if (label.startsWith(needle)) return 3;
  if (label.includes(needle)) return 2;
  return page.aliases.some((alias) => alias.toLowerCase().includes(needle)) ? 1 : 0;
}

/**
 * Case-insensitive substring match on titles (Logiwa parity) plus aliases. Prefix matches
 * rank first; ties keep nav-config order (the order users see in the menus).
 */
export function matchPages(
  pages: readonly (PageHit & { readonly aliases: readonly string[] })[],
  query: string,
  limit = MAX_PAGE_HITS,
): readonly PageHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return pages
    .map((page, index) => ({ page, index, score: pageScore(page, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ page }) => ({ label: page.label, href: page.href, trail: page.trail }));
}

/** Splits `text` into parts with every case-insensitive occurrence of `query` flagged. */
export function highlightParts(text: string, query: string): readonly HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  let index = lower.indexOf(needle, cursor);
  while (index !== -1) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

const recentSchema = z.array(z.string().min(1).max(100)).max(50);

export function parseRecentSearches(raw: string | null): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = recentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, RECENT_SEARCH_LIMIT) : [];
  } catch {
    return [];
  }
}

/** New list with `term` moved to the front (deduplicated, capped). */
export function pushRecentSearch(list: readonly string[], term: string): readonly string[] {
  const clean = term.trim();
  if (clean.length < MIN_RECORD_QUERY) return list;
  return [clean, ...list.filter((t) => t.toLowerCase() !== clean.toLowerCase())].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}

export function readRecentSearches(): readonly string[] {
  try {
    return parseRecentSearches(window.localStorage.getItem(RECENT_SEARCH_KEY));
  } catch {
    return [];
  }
}

export function writeRecentSearches(list: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode / quota): recent searches are a convenience only.
  }
}

/* ---------------- result ordering ---------------- */

/** Same scale as the server's hit ranks: 0 exact, 1 prefix, 2 contains, 3 other field. */
const RANK_OTHER = 3;

/** Best rank among the page hits (an exact page title is 0, a title prefix 1, …). */
export function pageRank(hits: readonly PageHit[], query: string): number {
  const needle = query.trim().toLowerCase();
  let best = RANK_OTHER;
  for (const hit of hits) {
    const label = hit.label.toLowerCase();
    if (label === needle) return 0;
    if (label.startsWith(needle)) best = Math.min(best, 1);
    else if (label.includes(needle)) best = Math.min(best, 2);
  }
  return best;
}

export interface RankedGroup {
  readonly key: string;
  readonly bestRank?: number;
}

/**
 * Orders the Pages section and the record groups by best match, exact first; ties keep
 * Pages first, then the server's order. `pagesRank` null = no page hits.
 */
export function orderSearchSections<G extends RankedGroup>(
  pagesRank: number | null,
  groups: readonly G[],
): readonly ('pages' | G)[] {
  const entries: { readonly item: 'pages' | G; readonly rank: number; readonly order: number }[] = [
    ...(pagesRank === null ? [] : [{ item: 'pages' as const, rank: pagesRank, order: -1 }]),
    ...groups.map((group, order) => ({ item: group, rank: group.bestRank ?? RANK_OTHER, order })),
  ];
  return [...entries].sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.item);
}

/** "See all 12 orders →" — `label` is the plural group heading ("Orders"). */
export function seeAllLabel(total: number, label: string): string {
  // "See all 1 clients" reads wrong; a single match links to the list instead.
  if (total <= 1) return `View in ${label}`;
  return `See all ${total.toLocaleString('en-US')} ${label.toLowerCase()}`;
}

/** Record search gives up after this long and offers Retry instead of an endless skeleton. */
export const RECORD_SEARCH_TIMEOUT_MS = 10_000;

/**
 * `signal` that also aborts after `ms` (reason: a `TimeoutError` DOMException, which the
 * API client surfaces as a NETWORK error). Falls back to a manual controller where
 * `AbortSignal.any`/`AbortSignal.timeout` are missing.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Record search timed out', 'TimeoutError')),
    ms,
  );
  const stop = (): void => clearTimeout(timer);
  controller.signal.addEventListener('abort', stop, { once: true });
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}
