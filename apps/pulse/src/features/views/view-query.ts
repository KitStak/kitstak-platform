/**
 * Saved views keep the state of a list as its URL query string: filters, sort, columns and date
 * range all live in the address bar, so a view is just "the query to go back to". Pure helpers.
 */

/** Sorted, de-duplicated query with the ignored keys removed, so two addresses compare equal when they show the same thing. */
export function normalizeQuery(query: string | URLSearchParams | null | undefined, ignore: readonly string[] = []): string {
  const params = new URLSearchParams(typeof query === 'string' ? query.replace(/^\?/, '') : (query?.toString() ?? ''));
  const skip = new Set(ignore);
  const pairs: [string, string][] = [];
  for (const [key, value] of params) {
    if (skip.has(key) || value === '') continue;
    pairs.push([key, value]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const out = new URLSearchParams();
  for (const [key, value] of pairs) out.append(key, value);
  return out.toString();
}

/** The stored config of a view. `query` is a normalized query string. */
export interface ViewConfig {
  readonly query: string;
}

export function toViewConfig(query: string | URLSearchParams | null | undefined, ignore: readonly string[] = []): ViewConfig {
  return { query: normalizeQuery(query, ignore) };
}

/** Reads a stored config. Older or foreign shapes give an empty query instead of throwing. */
export function readViewConfig(config: unknown): ViewConfig {
  if (config !== null && typeof config === 'object' && typeof (config as { query?: unknown }).query === 'string') {
    return { query: normalizeQuery((config as { query: string }).query) };
  }
  return { query: '' };
}

/** A path with the view's query on it. */
export function viewHref(pathname: string, config: ViewConfig): string {
  return config.query ? `${pathname}?${config.query}` : pathname;
}

/** A short plain summary of what a view holds, like "3 filters". */
export function describeQuery(query: string): string {
  const count = new Set([...new URLSearchParams(query).keys()]).size;
  return count === 0 ? 'No filters' : count === 1 ? '1 filter' : `${count} filters`;
}
