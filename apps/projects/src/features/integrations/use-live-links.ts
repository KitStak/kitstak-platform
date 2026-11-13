'use client';
/**
 * Keeps linked CRM/WMS record statuses live: re-reads them from the sibling apps when the view
 * mounts and whenever the window regains focus or becomes visible, if the cached copy is older
 * than `maxAgeMs`. Silent (no toasts); the caller's `refresh` reloads the data afterwards.
 */
import { useEffect, useRef } from 'react';

export function isStale(cachedAt: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!cachedAt) return true;
  const at = Date.parse(cachedAt);
  return !Number.isFinite(at) || now - at > maxAgeMs;
}

export function useLiveLinks(
  links: readonly { readonly cachedAt: string | null }[],
  recheck: () => Promise<unknown>,
  maxAgeMs = 60_000,
): void {
  const state = useRef({ links, recheck, running: false });
  useEffect(() => {
    state.current.links = links;
    state.current.recheck = recheck;
  });
  useEffect(() => {
    const run = () => {
      const current = state.current;
      if (current.running || document.visibilityState === 'hidden') return;
      if (current.links.length === 0 || !current.links.some((link) => isStale(link.cachedAt, maxAgeMs))) return;
      current.running = true;
      void current.recheck().finally(() => {
        current.running = false;
      });
    };
    run();
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [maxAgeMs]);
}
