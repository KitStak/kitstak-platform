'use client';
/**
 * List state that lives in the address bar, so a list can be bookmarked, shared and kept as a
 * saved view (`SavedViewsBar` stores the query string). Writes go through
 * `window.history.replaceState`, which Next keeps in step with `useSearchParams` without asking
 * the server for the page again.
 *
 *   const url = useUrlState();
 *   const tab = url.get('tab') ?? 'open';
 *   url.set({ tab: 'done', q: null });      // null, undefined or '' removes a key
 *
 *   const [search, setSearch] = useUrlText('q');   // typed text: instant on screen, URL a beat later
 */
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type UrlPatch = Readonly<Record<string, string | null | undefined>>;

/** Merges a patch into a query string. Pure, so it can be tested. */
export function patchQuery(current: string, patch: UrlPatch): string {
  const next = new URLSearchParams(current.replace(/^\?/, ''));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

export function useUrlState() {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const get = useCallback((key: string): string | null => params?.get(key) ?? null, [params]);
  const set = useCallback(
    (patch: UrlPatch) => {
      // Read the live address, not the last render: two sets in one tick must both land.
      const query = patchQuery(window.location.search, patch);
      const href = query ? `${pathname}?${query}` : pathname;
      if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
    },
    [pathname],
  );
  return useMemo(() => ({ get, set }), [get, set]);
}

/**
 * A text box whose value is also a query key. Typing shows at once and reaches the address bar
 * after a short pause; a change that comes from the address bar (a saved view, Back) is adopted.
 */
export function useUrlText(key: string, delayMs = 250): readonly [string, (value: string) => void] {
  const url = useUrlState();
  const fromUrl = url.get(key) ?? '';
  const [text, setText] = useState(fromUrl);
  const [seen, setSeen] = useState(fromUrl);
  const [sent, setSent] = useState<string | null>(null);
  // The address changed and it was not our own write landing late: take it.
  if (fromUrl !== seen) {
    setSeen(fromUrl);
    if (fromUrl !== sent && fromUrl !== text) setText(fromUrl);
  }
  useEffect(() => {
    if (text === fromUrl) return;
    const timer = window.setTimeout(() => {
      setSent(text);
      url.set({ [key]: text });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [text, fromUrl, key, delayMs, url]);
  return [text, setText] as const;
}
