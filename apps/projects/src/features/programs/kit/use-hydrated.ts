'use client';
/**
 * False on the server and while React hydrates, true after. Program cards that read shared caches
 * (the programs list the sidebar also loads) render their data only once hydrated, so a segment
 * that hydrates after the sidebar fetched never mismatches the server HTML.
 */
import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
