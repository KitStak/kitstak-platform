import type { Module } from '@kitstak/entitlements';

export interface SearchableApp {
  readonly module: Module;
  readonly name: string;
  readonly tagline: string;
}

/**
 * The home page's "Search apps" filter. Every word of the query has to appear somewhere in the
 * app's name, tagline or id, in any order and any case. A blank query keeps every app.
 */
export function filterApps<T extends SearchableApp>(apps: readonly T[], query: string): readonly T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return apps;
  return apps.filter((app) => {
    const haystack = `${app.name} ${app.tagline} ${app.module}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
