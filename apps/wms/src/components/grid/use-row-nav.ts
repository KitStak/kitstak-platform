'use client';

/**
 * Drill-in navigation for grid rows with instant feedback.
 *
 * App Router keeps the old view on screen while a heavy detail route loads, so a plain
 * `router.push` in `onRowClick` showed nothing for seconds. `navigate`:
 *
 *   1. marks the clicked row/card in the DOM synchronously (`data-pending-nav`, styled in
 *      globals.css) — it paints on the next frame, well inside 100ms, because every React
 *      render that follows runs at transition priority and yields to paint;
 *   2. starts the 2px route-progress bar immediately (`startRouteProgress`);
 *   3. pushes the route inside a transition, with the matching React state updated at the
 *      same low priority so the big grid re-render never blocks the first frame.
 *
 * A successful navigation unmounts the grid; a blocked or failed one is cleaned up by the
 * safety timer so the row never sticks in its pending look. Any grid page can adopt it:
 *
 *   const nav = useRowNav();
 *   <DataGrid onRowClick={(row) => nav.navigate(row.id, `/orders/${row.code}`)}
 *             pendingRowId={nav.pendingRowId} ... />
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { startRouteProgress } from '@/components/layout/route-progress';

/** A navigation that never lands (error, unsaved-changes guard) clears its overlay after this. */
const SAFETY_MS = 8000;

export interface RowNav {
  /** Row id currently navigating away (style it as pending), or null. */
  readonly pendingRowId: string | null;
  /** Push `href`, marking `rowId` pending until the route lands. */
  readonly navigate: (rowId: string, href: string) => void;
}

function clearDomMarks(): void {
  for (const el of document.querySelectorAll('[data-pending-nav]'))
    el.removeAttribute('data-pending-nav');
}

export function useRowNav(): RowNav {
  const router = useRouter();
  const [pendingRowId, setPendingRowId] = React.useState<string | null>(null);
  const safety = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (safety.current !== null) window.clearTimeout(safety.current);
    },
    [],
  );

  const navigate = React.useCallback(
    (rowId: string, href: string) => {
      // DOM first: the mark paints before React touches the (large) grid tree. The state
      // below reconciles the same attribute on commit, at transition priority. All matches:
      // the row exists twice when a grid renders both a table row and a mobile card.
      for (const el of document.querySelectorAll(`[data-row-id="${CSS.escape(rowId)}"]`))
        el.setAttribute('data-pending-nav', '');
      startRouteProgress(href);
      React.startTransition(() => {
        setPendingRowId(rowId);
        router.push(href);
      });
      if (safety.current !== null) window.clearTimeout(safety.current);
      safety.current = window.setTimeout(() => {
        setPendingRowId(null);
        clearDomMarks();
      }, SAFETY_MS);
    },
    [router],
  );

  return { pendingRowId, navigate };
}
