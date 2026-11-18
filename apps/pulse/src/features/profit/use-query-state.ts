'use client';
/**
 * Page state that lives in the URL query string, so any view can be bookmarked, shared and
 * exported as seen. `set` merges a patch (null or undefined removes a key) and replaces the URL
 * without a scroll jump or a server round trip for the frame.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export type QueryPatch = Readonly<Record<string, string | null | undefined>>;

export function buildQuery(current: URLSearchParams | null, patch: QueryPatch): string {
  const next = new URLSearchParams(current?.toString() ?? '');
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

export function useQueryState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const get = useCallback((name: string): string | null => params?.get(name) ?? null, [params]);
  const set = useCallback(
    (patch: QueryPatch, options: { push?: boolean } = {}) => {
      const query = buildQuery(params, patch);
      const href = query ? `${pathname}?${query}` : pathname;
      if (options.push) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [params, pathname, router],
  );
  /** Replaces the whole query (used by saved views and "Clear filters"). */
  const replaceAll = useCallback(
    (next: QueryPatch) => {
      const query = buildQuery(null, next);
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );
  return useMemo(() => ({ get, set, replaceAll, params }), [get, set, replaceAll, params]);
}
