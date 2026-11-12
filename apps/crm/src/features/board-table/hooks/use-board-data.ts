'use client';

/**
 * Board data for the table: the first-paint payload plus every remaining item page (fetched
 * in the background so 5k-item boards fill in without blocking), subitems of expanded rows,
 * and the realtime stream.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useApi, useBoard, useBoardItems, useBoardStream, useMe, useOrgId } from '@/lib/hooks';
import type { ItemDto } from '@/server/services/contracts/dto';
import type { SubitemState } from '../lib/rows';

export function useBoardData(boardId: string, options: { currentUserId?: string; realtime?: boolean } = {}) {
  const payload = useBoard(boardId);
  const me = useMe();
  const currentUserId = options.currentUserId ?? me.data?.user.id;
  const nextCursor = payload.data?.nextCursor ?? null;
  const pages = useBoardItems(boardId, {
    startCursor: nextCursor,
    enabled: Boolean(payload.data && nextCursor),
  });

  useBoardStream({ boardId, currentUserId, enabled: options.realtime ?? true });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const items = useMemo<readonly ItemDto[]>(() => {
    const first = payload.data?.items ?? [];
    const rest = nextCursor ? (pages.data?.pages.flatMap((page) => page.items) ?? []) : [];
    if (!rest.length) return first;
    const seen = new Set(first.map((item) => item.id));
    return [...first, ...rest.filter((item) => !seen.has(item.id))];
  }, [nextCursor, pages.data?.pages, payload.data?.items]);

  return {
    payload,
    items,
    currentUserId,
    loadingMore: Boolean(nextCursor) && (pages.isLoading || pages.hasNextPage === true),
  };
}

/** Subitems for each expanded item, keyed by parent id. */
export function useSubitemMap(expanded: ReadonlySet<string>): ReadonlyMap<string, SubitemState> {
  const api = useApi();
  const orgId = useOrgId();
  const ids = useMemo(() => [...expanded].filter((id) => !id.startsWith('temp-')).sort(), [expanded]);
  const combine = useCallback(
    (results: readonly { data?: readonly ItemDto[]; isPending: boolean; isError: boolean }[]) => {
      const map = new Map<string, SubitemState>();
      ids.forEach((id, index) => {
        const result = results[index];
        if (!result || result.isPending) map.set(id, 'loading');
        else if (result.isError) map.set(id, 'error');
        else
          map.set(
            id,
            [...(result.data ?? [])].sort((a, b) =>
              a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
            ),
          );
      });
      return map as ReadonlyMap<string, SubitemState>;
    },
    [ids],
  );
  const map = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.subitems(orgId, id),
      queryFn: () => api.items.subitems(id),
      staleTime: 15_000,
    })),
    combine,
  });
  // Keep the identity stable while nothing changed (the row model memoizes on it).
  const signature = [...map]
    .map(
      ([id, state]) =>
        `${id}:${Array.isArray(state) ? state.map((item) => `${item.id}@${item.updatedAt}`).join(',') : state}`,
    )
    .join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` captures every change of `map`
  return useMemo(() => map, [signature]);
}
