'use client';

/** Which view tab is open: `?view=<id>` (falls back to the default view). */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ViewDto } from '@/server/services/contracts/dto';
import { patchBoardSearch, VIEW_PARAM } from '../lib/url-state';
import { resolveActiveView, sortViews } from '../lib/view-order';

export interface ActiveViewApi {
  readonly views: readonly ViewDto[];
  readonly active: ViewDto | null;
  readonly defaultViewId: string | null;
  readonly select: (viewId: string) => void;
}

export function useActiveView(views: readonly ViewDto[] | undefined): ActiveViewApi {
  const params = useSearchParams();
  const requested = params.get(VIEW_PARAM);
  const sorted = useMemo(() => sortViews(views ?? []), [views]);
  const active = useMemo(() => resolveActiveView(sorted, requested), [requested, sorted]);
  const defaultViewId = useMemo(() => resolveActiveView(sorted, null)?.id ?? null, [sorted]);

  const select = useCallback(
    (viewId: string) => {
      const next = patchBoardSearch(window.location.search, {
        viewId: viewId === defaultViewId ? null : viewId,
        overlay: null,
        search: '',
      });
      // Switching views is navigation: Back returns to the previous view.
      window.history.pushState(null, '', `${window.location.pathname}${next}`);
    },
    [defaultViewId],
  );

  return { views: sorted, active, defaultViewId, select };
}
