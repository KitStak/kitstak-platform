'use client';
/**
 * Notifications data layer for the Activity panel: filtered infinite feed (previous results stay
 * visible while a new tab/search loads), optimistic read/unread patched in the click's tick
 * (with a server-exact Undo for "mark all"), delete with an Undo window that survives realtime
 * refetches and tab close, and the org-level realtime stream that keeps the bell badge live.
 *
 * Feed queries live under `queryKeys.notificationsRoot` so every existing invalidation (and
 * `useMarkNotifications` in src/lib/hooks) also reaches them.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { apiRequest, apiRequestWithMeta, buildApiUrl, type Paginated } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toastError } from '@/lib/hooks/cache';
import { useOrgId } from '@/lib/hooks/org-context';
import type { MeDto, NotificationDto } from '@/server/services/contracts/dto';
import type { RealtimeEvent } from '@/server/realtime/events';
import { inScope } from './describe';

export type PanelTab = 'all' | 'unread' | 'mentions' | 'assigned';

export interface FeedParams {
  readonly filter: PanelTab;
  readonly boardId?: string;
  readonly q?: string;
}

export interface FeedPage extends Paginated<NotificationDto> {
  readonly unreadCount: number;
}

type FeedData = InfiniteData<FeedPage, string | null>;

const PAGE_SIZE = 25;

/** Query key for one feed variant (under the notifications root). */
export function feedKey(orgId: string, params: FeedParams) {
  return [
    ...queryKeys.notificationsRoot(orgId),
    'panel',
    { filter: params.filter, boardId: params.boardId ?? null, q: params.q ?? '' },
  ] as const;
}

/** Shell's `useMe` cache (drives the top-bar badge). */
const shellMeKey = (orgId: string) => ['org', orgId, 'me'] as const;

/** Notifications deleted optimistically whose server delete has not been sent yet. */
const pendingDeletes = new Map<string, () => void>();

async function fetchFeed(
  orgId: string,
  params: FeedParams,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<FeedPage> {
  const { data, meta } = await apiRequestWithMeta<NotificationDto[]>('/notifications', {
    orgId,
    signal,
    query: {
      limit: PAGE_SIZE,
      filter: params.filter,
      cursor: cursor ?? undefined,
      boardId: params.boardId,
      q: params.q || undefined,
    },
  });
  return {
    // Rows inside their delete-Undo window stay hidden even when a refetch returns them.
    items: pendingDeletes.size ? data.filter((entry) => !pendingDeletes.has(entry.id)) : data,
    nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
    meta,
    unreadCount: typeof meta?.unreadCount === 'number' ? meta.unreadCount : 0,
  };
}

export function useNotificationFeed(params: FeedParams, enabled = true) {
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: feedKey(orgId, params),
    queryFn: ({ pageParam, signal }) => fetchFeed(orgId, params, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: FeedPage) => last.nextCursor,
    enabled,
    // Switching tab or typing a search keeps the previous rows (dimmed) instead of skeletons.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** Warm the other tabs when the panel opens so switching is instant. */
export function usePrefetchNotificationTabs() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return (tabs: readonly PanelTab[], base: Omit<FeedParams, 'filter'>) => {
    for (const filter of tabs) {
      const params: FeedParams = { ...base, filter };
      void queryClient.prefetchInfiniteQuery({
        queryKey: feedKey(orgId, params),
        queryFn: ({ pageParam, signal }) => fetchFeed(orgId, params, pageParam, signal),
        initialPageParam: null as string | null,
        staleTime: 15_000,
      });
    }
  };
}

/** Write the unread total everywhere it is displayed (bell badge, tab counts). */
export function setUnreadEverywhere(queryClient: QueryClient, orgId: string, unreadCount: number): void {
  queryClient.setQueryData(queryKeys.unreadCount(orgId), { unreadCount });
  queryClient.setQueryData<MeDto>(shellMeKey(orgId), (me) =>
    me ? { ...me, unreadNotifications: unreadCount } : me,
  );
  queryClient.setQueriesData<FeedData>({ queryKey: queryKeys.notificationsRoot(orgId) }, (data) =>
    data?.pages ? { ...data, pages: data.pages.map((page) => ({ ...page, unreadCount })) } : data,
  );
}

function currentUnread(queryClient: QueryClient, orgId: string): number | null {
  const me = queryClient.getQueryData<MeDto>(shellMeKey(orgId));
  return me ? me.unreadNotifications : null;
}

function patchFeeds(
  queryClient: QueryClient,
  orgId: string,
  patch: (entry: NotificationDto) => NotificationDto | null,
): void {
  queryClient.setQueriesData<FeedData>({ queryKey: queryKeys.notificationsRoot(orgId) }, (data) =>
    data?.pages
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((entry) => {
              const next = patch(entry);
              return next ? [next] : [];
            }),
          })),
        }
      : data,
  );
}

function cancelAll(queryClient: QueryClient, orgId: string): Promise<unknown> {
  return Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.notificationsRoot(orgId) }),
    queryClient.cancelQueries({ queryKey: shellMeKey(orgId) }),
    queryClient.cancelQueries({ queryKey: queryKeys.unreadCount(orgId) }),
  ]);
}

/**
 * Optimistic write in the click's tick: apply, then cancel in-flight fetches (a cancelled fetch
 * reverts its query to pre-fetch data, which would drop the patch) and apply again.
 */
async function optimistic(queryClient: QueryClient, orgId: string, apply: () => void): Promise<void> {
  apply();
  await cancelAll(queryClient, orgId);
  apply();
}

export interface MarkInput {
  readonly ids?: readonly string[];
  readonly all?: boolean;
  readonly read: boolean;
  /** With `all`: scope to the panel's board filter / search ("Mark these as read"). */
  readonly boardId?: string;
  readonly q?: string;
  /** Show the Undo toast for this write (mark all). */
  readonly undoable?: boolean;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // An Undo that is never clicked must not surface an unhandled rejection.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

interface MarkContext {
  /** Rows this mutation flipped locally, with their previous `readAt` (targeted rollback). */
  readonly flipped: ReadonlyMap<string, string | null>;
  readonly readAt: string | null;
  /** Server ids for the optimistic Undo toast (mark all). */
  readonly undoIds?: Deferred<readonly string[]>;
  readonly toastId?: string | number;
}

type MarkResult = { updated: number; unreadCount: number; ids?: string[] };

const markKey = (orgId: string) => ['notifications', orgId, 'mark-read'] as const;

export function useMarkRead() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const mutation = useMutation<MarkResult, unknown, MarkInput, MarkContext>({
    mutationKey: markKey(orgId),
    // Serialize read/unread writes so rapid toggles reach the server in click order.
    scope: { id: `notifications-read-${orgId}` },
    mutationFn: (input: MarkInput) =>
      apiRequest<MarkResult>('/notifications/read', {
        orgId,
        method: 'POST',
        body: input.all
          ? { all: true, read: input.read, boardId: input.boardId, q: input.q || undefined }
          : { ids: input.ids, read: input.read },
      }),
    onMutate: async (input) => {
      const ids = new Set(input.ids ?? []);
      const readAt = input.read ? new Date().toISOString() : null;
      const scoped = Boolean(input.boardId || input.q);
      const before = currentUnread(queryClient, orgId);
      const flipped = new Map<string, string | null>();
      const apply = () => {
        patchFeeds(queryClient, orgId, (entry) => {
          const hit = input.all ? inScope(entry, input) : ids.has(entry.id);
          if (!hit || Boolean(entry.readAt) === input.read) return entry;
          if (!flipped.has(entry.id)) flipped.set(entry.id, entry.readAt);
          return { ...entry, readAt };
        });
        if (before === null) return;
        // Unscoped mark-all reads everything; otherwise count the rows that actually flipped.
        const delta = flipped.size;
        const next = input.all && input.read && !scoped ? 0 : before + (input.read ? -delta : delta);
        setUnreadEverywhere(queryClient, orgId, Math.max(0, next));
      };
      apply();
      // Mark all confirms instantly: the toast shows now and its Undo waits for the server's ids.
      let undoIds: Deferred<readonly string[]> | undefined;
      let toastId: string | number | undefined;
      const estimate = input.all && !scoped && before !== null ? before : flipped.size;
      if (input.undoable && estimate > 0) {
        const pendingIds = deferred<readonly string[]>();
        undoIds = pendingIds;
        toastId = toast.undo(
          `Marked ${estimate} ${estimate === 1 ? 'notification' : 'notifications'} as read`,
          {
            onUndo: async () => {
              const changed = await pendingIds.promise;
              for (let index = 0; index < changed.length; index += UNDO_BATCH) {
                await mutation.mutateAsync({ ids: changed.slice(index, index + UNDO_BATCH), read: !input.read });
              }
            },
          },
        );
      }
      await optimistic(queryClient, orgId, apply);
      return { flipped, readAt, undoIds, toastId };
    },
    onError: (error, _input, context) => {
      // Roll back only the rows this write flipped (and only if nothing newer changed them),
      // never a whole-cache snapshot that would clobber later queued writes. Then the server wins.
      if (context) {
        patchFeeds(queryClient, orgId, (entry) =>
          context.flipped.has(entry.id) && entry.readAt === context.readAt
            ? { ...entry, readAt: context.flipped.get(entry.id) ?? null }
            : entry,
        );
        context.undoIds?.reject(error);
        if (context.toastId !== undefined) toast.dismiss(context.toastId);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot(orgId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount(orgId) });
      void queryClient.invalidateQueries({ queryKey: shellMeKey(orgId), exact: true });
      toastError(error, 'Could not update notifications');
    },
    onSuccess: (result, _input, context) => {
      setUnreadEverywhere(queryClient, orgId, result.unreadCount);
      // The server returns exactly the ids it flipped, so Undo restores every one of them,
      // including rows that were never loaded into the panel.
      context?.undoIds?.resolve(result.ids ?? []);
    },
    onSettled: () => {
      // Once the queue drains, refetch the open feed: a fetch cancelled by the optimistic patch
      // (e.g. a tab that was still loading) resumes, and the list matches the server.
      if (queryClient.isMutating({ mutationKey: markKey(orgId) }) <= 1)
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot(orgId) });
    },
  });
  return mutation;
}

/** Max ids per mark request (server schema limit). */
const UNDO_BATCH = 500;

const DELETE_DELAY_MS = 6000;

/** Fire every pending delete now (tab hidden / closing): keepalive survives unload. */
function flushPendingDeletes(): void {
  for (const commit of [...pendingDeletes.values()]) commit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingDeletes);
}

interface RowPosition {
  readonly key: QueryKey;
  readonly page: number;
  readonly index: number;
}

/** Where `id` sits in each cached feed, so Undo can put back just that row. */
function positionsOf(queryClient: QueryClient, orgId: string, id: string): RowPosition[] {
  const out: RowPosition[] = [];
  for (const [key, data] of queryClient.getQueriesData<FeedData>({
    queryKey: queryKeys.notificationsRoot(orgId),
  })) {
    data?.pages?.forEach((page, pageIndex) => {
      const index = page.items.findIndex((entry) => entry.id === id);
      if (index >= 0) out.push({ key, page: pageIndex, index });
    });
  }
  return out;
}

function reinsert(queryClient: QueryClient, positions: readonly RowPosition[], entry: NotificationDto): void {
  for (const position of positions) {
    queryClient.setQueryData<FeedData>(position.key, (data) => {
      if (!data?.pages?.[position.page]) return data;
      if (data.pages.some((page) => page.items.some((row) => row.id === entry.id))) return data;
      return {
        ...data,
        pages: data.pages.map((page, pageIndex) => {
          if (pageIndex !== position.page) return page;
          const items = [...page.items];
          items.splice(Math.min(position.index, items.length), 0, entry);
          return { ...page, items };
        }),
      };
    });
  }
}

/**
 * Remove now (optimistic) and commit after the Undo window. The row stays hidden through
 * realtime refetches, the delete is flushed with `keepalive` if the tab closes, and Undo puts
 * back only that row (later read toggles on other rows are kept).
 */
export function useDeleteNotification() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useCallback((entry: NotificationDto) => {
    const positions = positionsOf(queryClient, orgId, entry.id);
    patchFeeds(queryClient, orgId, (row) => (row.id === entry.id ? null : row));
    const before = currentUnread(queryClient, orgId);
    if (before !== null && !entry.readAt) setUnreadEverywhere(queryClient, orgId, Math.max(0, before - 1));

    let timer: ReturnType<typeof setTimeout> | null = null;
    const commit = () => {
      if (!pendingDeletes.has(entry.id)) return;
      pendingDeletes.delete(entry.id);
      if (timer) clearTimeout(timer);
      apiRequest<{ id: string; unreadCount: number }>(`/notifications/${entry.id}`, {
        orgId,
        method: 'DELETE',
        keepalive: true,
      })
        .then((result) => setUnreadEverywhere(queryClient, orgId, result.unreadCount))
        .catch((error: unknown) => {
          reinsert(queryClient, positions, entry);
          void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot(orgId) });
          toastError(error, 'Could not delete the notification');
        });
    };
    pendingDeletes.set(entry.id, commit);
    timer = setTimeout(commit, DELETE_DELAY_MS);
    toast.undo('Notification deleted', {
      duration: DELETE_DELAY_MS,
      onUndo: () => {
        if (!pendingDeletes.delete(entry.id)) return;
        if (timer) clearTimeout(timer);
        reinsert(queryClient, positions, entry);
        const now = currentUnread(queryClient, orgId);
        if (now !== null && !entry.readAt) setUnreadEverywhere(queryClient, orgId, now + 1);
      },
    });
  }, [orgId, queryClient]);
}

// ---------------------------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------------------------

/** Extra query prefixes refreshed when the user's notifications change (inbox feed etc.). */
const DEPENDENT_PREFIXES = (orgId: string) => [['org', orgId, 'inbox']] as const;

/**
 * Org-level SSE subscription (no board): delivers `notifications.changed` addressed to the user
 * within ~1s and refreshes the badge + open feeds. Reconnects are handled by EventSource.
 */
export function useNotificationsRealtime(enabled = true): void {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const source = new EventSource(buildApiUrl(`/orgs/${orgId}/stream`), { withCredentials: true });
    const refresh = () => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot(orgId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount(orgId) });
      void queryClient.invalidateQueries({ queryKey: shellMeKey(orgId), exact: true });
      for (const prefix of DEPENDENT_PREFIXES(orgId))
        void queryClient.invalidateQueries({ queryKey: prefix });
    };
    const schedule = () => {
      if (!timer.current) timer.current = setTimeout(refresh, 120);
    };
    const onChange = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as RealtimeEvent;
        if (event.type === 'notifications.changed') schedule();
      } catch {
        /* malformed frame: ignore, the next event or resync refreshes */
      }
    };
    source.addEventListener('change', onChange as EventListener);
    source.addEventListener('resync', schedule);
    return () => {
      source.removeEventListener('change', onChange as EventListener);
      source.removeEventListener('resync', schedule);
      source.close();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enabled, orgId, queryClient]);
}
