'use client';
/**
 * Inbox mutations with optimistic cache updates (every cached inbox list + the unread badge),
 * rollback on failure and an Undo toast for archive. Used by Inbox and the Home inbox preview.
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import type { InboxPage } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { NotificationDTO } from '@/lib/types';
import { archiveNotificationsAction, markAllNotificationsReadAction, markNotificationsReadAction } from '@/server/actions/notifications';
import { taskKeyFromUrl } from './notification-utils';

type Snapshot = [readonly unknown[], unknown][];

const isInboxList = (key: readonly unknown[]) => key[0] === 'notifications' && key[1] !== 'unread-count';

function snapshot(queryClient: QueryClient): Snapshot {
  return queryClient.getQueriesData({ queryKey: ['notifications'] }).map(([key, data]) => [key, data]);
}

function restore(queryClient: QueryClient, saved: Snapshot) {
  for (const [key, data] of saved) queryClient.setQueryData(key, data);
}

function refresh(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
}

type InfinitePages = { readonly pages: readonly InboxPage[]; readonly pageParams: readonly unknown[] };

function patchPage(page: InboxPage, fn: (item: NotificationDTO) => NotificationDTO | null, unreadDelta: number): InboxPage {
  const items: NotificationDTO[] = [];
  for (const item of page.items) {
    const next = fn(item);
    if (next) items.push(next);
  }
  return { ...page, items, unread: Math.max(0, page.unread + unreadDelta) };
}

/**
 * Patch every cached inbox list (plain pages and the Inbox's infinite list); `fn` returns the new
 * item, or null to drop it from that list.
 */
function patchAll(queryClient: QueryClient, fn: (item: NotificationDTO, filter: string) => NotificationDTO | null, unreadDelta: number) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['notifications'] })) {
    const key = query.queryKey;
    if (!isInboxList(key)) continue;
    const filter = String(key[1] ?? 'all');
    queryClient.setQueryData<InboxPage | InfinitePages>(key, (data) => {
      if (!data) return data;
      if ('pages' in data && Array.isArray(data.pages)) {
        return { ...data, pages: data.pages.map((page) => patchPage(page, (item) => fn(item, filter), unreadDelta)) };
      }
      if ('items' in data && Array.isArray(data.items)) return patchPage(data, (item) => fn(item, filter), unreadDelta);
      return data;
    });
  }
  queryClient.setQueryData<{ count: number }>(qk.unread(), (current) => (current ? { count: Math.max(0, current.count + unreadDelta) } : current));
}

export function useInboxActions() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { openTask } = useTaskDrawer();

  const markRead = useCallback(
    async (items: readonly NotificationDTO[], read: boolean) => {
      const targets = items.filter((item) => Boolean(item.readAt) !== read);
      if (!targets.length) return;
      const ids = new Set(targets.map((item) => item.id));
      const delta = targets.filter((item) => !item.archivedAt).length * (read ? -1 : 1);
      const saved = snapshot(queryClient);
      const now = new Date().toISOString();
      patchAll(
        queryClient,
        (item, filter) => {
          if (!ids.has(item.id)) return item;
          if (read && filter === 'unread') return null;
          return { ...item, readAt: read ? now : null };
        },
        delta,
      );
      const result = await markNotificationsReadAction({ ids: [...ids], value: read });
      if (!result.ok) {
        restore(queryClient, saved);
        toast.error("Couldn't update that", result.error.message);
      }
      refresh(queryClient);
    },
    [queryClient],
  );

  const archive = useCallback(
    async (items: readonly NotificationDTO[], archived: boolean) => {
      if (!items.length) return;
      const ids = new Set(items.map((item) => item.id));
      const delta = archived ? -items.filter((item) => !item.readAt && !item.archivedAt).length : 0;
      const saved = snapshot(queryClient);
      patchAll(queryClient, (item, filter) => (ids.has(item.id) ? ((filter === 'archived') === archived ? item : null) : item), delta);
      const result = await archiveNotificationsAction({ ids: [...ids], value: archived });
      if (!result.ok) {
        restore(queryClient, saved);
        toast.error("Couldn't update that", result.error.message);
        return;
      }
      refresh(queryClient);
      const label = items.length === 1 ? 'notification' : `${items.length} notifications`;
      if (archived) {
        toast.undo(`Archived ${label}`, {
          onUndo: async () => {
            const undo = await archiveNotificationsAction({ ids: [...ids], value: false });
            if (!undo.ok) throw new Error(undo.error.message);
            refresh(queryClient);
          },
        });
      } else {
        toast.success(`Moved ${label} back to your inbox`);
      }
    },
    [queryClient],
  );

  const markAll = useCallback(async () => {
    const saved = snapshot(queryClient);
    const now = new Date().toISOString();
    const current = queryClient.getQueryData<{ count: number }>(qk.unread())?.count ?? 0;
    patchAll(queryClient, (item, filter) => (filter === 'unread' ? null : { ...item, readAt: item.readAt ?? now }), -current);
    const result = await markAllNotificationsReadAction();
    if (!result.ok) {
      restore(queryClient, saved);
      toast.error("Couldn't mark everything read", result.error.message);
    } else {
      toast.success(result.data ? `Marked ${result.data} as read` : 'Everything was already read');
    }
    refresh(queryClient);
  }, [queryClient]);

  /** Opens what the notification is about (task drawer when it's a task) and marks it read. */
  const open = useCallback(
    (item: NotificationDTO) => {
      if (!item.readAt) void markRead([item], true);
      const key = taskKeyFromUrl(item.url);
      if (key) openTask(key);
      else if (item.url) router.push(item.url);
    },
    [markRead, openTask, router],
  );

  return { markRead, archive, markAll, open } as const;
}
