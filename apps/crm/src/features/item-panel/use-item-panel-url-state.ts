'use client';

/**
 * Syncs the open item with the URL (`?item=<id>&itemTab=files&update=<id>`): deep links and
 * reloads reopen the same item and tab, and the browser Back button closes the panel.
 *
 * Uses the native History API (`pushState` / `replaceState`), which Next.js syncs into
 * `useSearchParams` without a server round trip, so opening and closing are instant.
 *
 * Opening from a closed state pushes one history entry; switching items or tabs replaces it,
 * so Back always returns to the board. Closing pops that entry when we pushed it, otherwise
 * (deep link / reload) it replaces the URL without the panel params.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { buildPanelHref, readPanelState, type PanelPatch, type PanelTab } from './lib/url-state';

/** Item id whose open pushed a history entry (module-level: shared by every hook instance). */
let pushedFor: string | null = null;

export interface ItemPanelUrlState {
  readonly itemId: string | null;
  readonly tab: PanelTab;
  /** Update to scroll to and highlight (shared update links). */
  readonly updateId: string | null;
  readonly isOpen: boolean;
  readonly open: (itemId: string, tab?: PanelTab) => void;
  readonly close: () => void;
  readonly setTab: (tab: PanelTab) => void;
  /** Switch to another item while keeping the panel open (prev/next, subitems). */
  readonly setItem: (itemId: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function useItemPanelUrlState(): ItemPanelUrlState {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const state = useMemo(() => readPanelState(new URLSearchParams(search)), [search]);

  useEffect(() => {
    if (!state.itemId) pushedFor = null;
  }, [state.itemId]);

  const href = useCallback((patch: PanelPatch) => buildPanelHref(pathname, search, patch), [pathname, search]);

  const open = useCallback(
    (itemId: string, tab?: PanelTab) => {
      const target = href({ itemId, tab: tab ?? null, updateId: null });
      if (state.itemId) {
        window.history.replaceState(null, '', target);
      } else {
        pushedFor = itemId;
        window.history.pushState(null, '', target);
      }
    },
    [href, state.itemId],
  );

  const close = useCallback(() => {
    if (pushedFor && typeof window !== 'undefined' && window.history.length > 1) {
      pushedFor = null;
      window.history.back();
      return;
    }
    pushedFor = null;
    window.history.replaceState(null, '', href({ itemId: null }));
  }, [href]);

  const setTab = useCallback(
    (tab: PanelTab) => {
      if (state.itemId) window.history.replaceState(null, '', href({ itemId: state.itemId, tab, updateId: null }));
    },
    [href, state.itemId],
  );

  const setItem = useCallback(
    (itemId: string) => window.history.replaceState(null, '', href({ itemId, updateId: null })),
    [href],
  );

  const onOpenChange = useCallback((next: boolean) => (next ? undefined : close()), [close]);

  return { ...state, isOpen: state.itemId !== null, open, close, setTab, setItem, onOpenChange };
}
