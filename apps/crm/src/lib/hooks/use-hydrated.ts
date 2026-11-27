'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False on the server and while React attaches to the server's HTML. True right after.
 *
 * Why: the shell fetches shared data (favorites, workspaces, the unread count) as soon as it is
 * live. A page below it can attach a moment later, and by then the answer may already be in the
 * cache. The page would draw rows where the server drew a loading placeholder, and React reports
 * a mismatch. A screen that shows a placeholder while it loads reads this flag too, so its first
 * browser pass always matches the server.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
