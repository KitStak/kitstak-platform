'use client';

/** Current user, notifications, favorites, recents and search. */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { accountApi, type Paginated } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { EntityType, FavoriteDto, NotificationDto } from '@/server/services/contracts/dto';
import { restore, snapshot, toastError } from './cache';
import { useApi, useOrgId } from './org-context';

/** Usable outside `<OrgProvider>` (org switcher, onboarding). */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => accountApi.me(signal),
    staleTime: 60_000,
  });
}

export function useOnboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accountApi.onboard,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
    onError: (error) => toastError(error, 'Could not create your workspace'),
  });
}

export type NotificationFilter = 'all' | 'unread' | 'mentions' | 'assigned';

export function useNotifications(filter: NotificationFilter = 'all') {
  const api = useApi();
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: queryKeys.notifications(orgId, filter),
    queryFn: ({ pageParam, signal }) =>
      api.notifications.list({ cursor: pageParam ?? undefined, limit: 30, filter }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<NotificationDto>) => last.nextCursor,
  });
}

export function useUnreadCount() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.unreadCount(orgId),
    queryFn: () => api.notifications.unreadCount(),
    select: (data) => data.unreadCount,
    refetchInterval: 120_000,
  });
}

export function useMarkNotifications() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean; read?: boolean }) => api.notifications.mark(input),
    onMutate: async (input) => {
      const saved = await snapshot(queryClient, queryKeys.notificationsRoot(orgId));
      const ids = new Set(input.ids ?? []);
      const readAt = input.read === false ? null : new Date().toISOString();
      queryClient.setQueriesData<{ pages: Paginated<NotificationDto>[]; pageParams: unknown[] }>(
        { queryKey: queryKeys.notificationsRoot(orgId) },
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((entry) =>
                    input.all || ids.has(entry.id) ? { ...entry, readAt } : entry,
                  ),
                })),
              }
            : data,
      );
      return { saved };
    },
    onError: (error, _input, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update notifications');
    },
    onSuccess: (result) =>
      queryClient.setQueryData(queryKeys.unreadCount(orgId), { unreadCount: result.unreadCount }),
  });
}

export function useFavorites() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.favorites(orgId),
    queryFn: () => api.favorites.list(),
    staleTime: 60_000,
  });
}

/** Optimistic star / unstar. */
export function useToggleFavorite() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { entityType: EntityType; entityId: string; favorite: boolean; name?: string }) =>
      vars.favorite
        ? api.favorites.add(vars.entityType, vars.entityId)
        : api.favorites.remove(vars.entityType, vars.entityId),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.favorites(orgId));
      queryClient.setQueryData<FavoriteDto[]>(queryKeys.favorites(orgId), (list) => {
        const current = list ?? [];
        if (!vars.favorite)
          return current.filter(
            (entry) => !(entry.entityType === vars.entityType && entry.entityId === vars.entityId),
          );
        if (current.some((entry) => entry.entityId === vars.entityId)) return current;
        return [
          ...current,
          {
            id: `temp-${vars.entityId}`,
            entityType: vars.entityType,
            entityId: vars.entityId,
            name: vars.name ?? '',
            position: 'zzzz',
            icon: null,
            boardKind: null,
          },
        ];
      });
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update favorites');
    },
    onSuccess: (list) => queryClient.setQueryData(queryKeys.favorites(orgId), list),
  });
}

export function useReorderFavorite() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { favoriteId: string; afterId?: string | null; beforeId?: string | null }) =>
      api.favorites.reorder(vars.favoriteId, { afterId: vars.afterId, beforeId: vars.beforeId }),
    onSuccess: (list) => queryClient.setQueryData(queryKeys.favorites(orgId), list),
    onError: (error) => toastError(error, 'Could not reorder favorites'),
  });
}

export function useRecents(limit = 20) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({ queryKey: queryKeys.recents(orgId), queryFn: () => api.recents.list(limit) });
}

/** Fire-and-forget visit tracking (board / item / dashboard opened). */
export function useRecordVisit() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { entityType: EntityType; entityId: string }) =>
      api.recents.record(vars.entityType, vars.entityId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.recents(orgId) }),
  });
}

/** Debounce the input before passing `q`; results keep the previous list while typing. */
export function useSearch(q: string, options: { types?: string[]; boardId?: string; limit?: number } = {}) {
  const api = useApi();
  const orgId = useOrgId();
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.search(orgId, trimmed, options),
    queryFn: ({ signal }) => api.search(trimmed, options, signal),
    enabled: trimmed.length >= 1,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
