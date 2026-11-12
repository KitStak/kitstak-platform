'use client';
/**
 * Local-first URL state: the control updates on the click (local state), and the query string
 * follows via `window.history.replaceState`, which Next's router and `useSearchParams` observe,
 * so there is no server round trip. Optional debounce for text inputs.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export function writeSearchParam(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

/**
 * `[value, setValue]` bound to one search param. `debounceMs` delays only the URL write; the
 * returned value changes immediately.
 */
export function useUrlState(
  key: string,
  debounceMs = 0,
): readonly [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const fromUrl = params.get(key);
  const [value, setLocal] = useState<string | null>(fromUrl);
  const written = useRef<string | null>(fromUrl);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow external URL changes (back/forward, links) but ignore echoes of our own writes.
  useEffect(() => {
    if (fromUrl !== written.current) {
      written.current = fromUrl;
      setLocal(fromUrl);
    }
  }, [fromUrl]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setValue = useCallback(
    (next: string | null) => {
      const normalized = next || null;
      setLocal(normalized);
      const flush = () => {
        written.current = normalized;
        writeSearchParam(key, normalized);
      };
      if (timer.current) clearTimeout(timer.current);
      if (debounceMs > 0) timer.current = setTimeout(flush, debounceMs);
      else flush();
    },
    [debounceMs, key],
  );

  return [value, setValue] as const;
}
