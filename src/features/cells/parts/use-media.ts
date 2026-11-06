'use client';
import { useSyncExternalStore } from 'react';

/** Below this width cell editors open as a bottom sheet instead of an anchored popover. */
export const SHEET_QUERY = '(max-width: 639px)';
/** Below this width range calendars show a single month. */
export const ONE_MONTH_QUERY = '(max-width: 559px)';

/** Reactive `matchMedia` (false during SSR and when matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}
