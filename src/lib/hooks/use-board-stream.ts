'use client';

/**
 * Realtime: subscribes to the board's SSE stream and invalidates the affected TanStack Query
 * keys. Events from the current user are skipped (their own optimistic updates already
 * applied), except for automation side effects which arrive with the same actor.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { RealtimeEvent } from '@/server/realtime/events';
import { useApi, useOrgId } from './org-context';

const DEBOUNCE_MS = 150;

export function invalidateForEvent(queryClient: QueryClient, orgId: string, event: RealtimeEvent): void {
  const boardId = event.boardId;
  const invalidate = (queryKey: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey });
  switch (event.type) {
    case 'notifications.changed':
      invalidate(queryKeys.notificationsRoot(orgId));
      invalidate(queryKeys.unreadCount(orgId));
      return;
    case 'workspace.changed':
      invalidate(queryKeys.workspaces(orgId));
      invalidate(['org', orgId, 'boards']);
      return;
    case 'board.deleted':
    case 'board.updated':
      if (boardId) invalidate(queryKeys.boardPayload(orgId, boardId));
      invalidate(queryKeys.workspaces(orgId));
      return;
    case 'automations.changed':
      if (boardId) invalidate(queryKeys.boardAutomations(orgId, boardId));
      invalidate(['org', orgId, 'automation-usage']);
      return;
    case 'updates.changed':
      for (const itemId of event.ids) invalidate(queryKeys.itemUpdates(orgId, itemId));
      return;
    case 'files.changed':
      if (boardId) invalidate(queryKeys.boardFiles(orgId, boardId));
      for (const itemId of event.ids) invalidate(queryKeys.itemFiles(orgId, itemId));
      return;
    default:
      // columns / groups / views / items: refresh the board and any open item panels.
      if (boardId) invalidate(queryKeys.board(orgId, boardId));
      for (const itemId of event.ids) invalidate(queryKeys.item(orgId, itemId));
  }
}

export interface BoardStreamOptions {
  readonly boardId?: string;
  readonly currentUserId?: string;
  readonly enabled?: boolean;
  /**
   * Event types to apply even when the current user caused them (e.g. an update posted from
   * another tab or device of the same user). Invalidation is cheap; default none.
   */
  readonly refreshOwn?: readonly RealtimeEvent['type'][];
}

export function useBoardStream(options: BoardStreamOptions = {}): void {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const pending = useRef(new Map<string, RealtimeEvent>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { boardId, currentUserId, enabled = true } = options;
  const refreshOwnKey = (options.refreshOwn ?? []).join(',');

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const source = new EventSource(api.streamUrl(boardId), { withCredentials: true });
    const buffer = pending.current;

    const flush = () => {
      timer.current = null;
      const events = [...buffer.values()];
      buffer.clear();
      for (const event of events) invalidateForEvent(queryClient, orgId, event);
    };

    const onChange = (message: MessageEvent<string>) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message.data) as RealtimeEvent;
      } catch {
        return;
      }
      const ownEvent = currentUserId && event.actorId === currentUserId;
      const refreshOwn = refreshOwnKey ? refreshOwnKey.split(',') : [];
      if (ownEvent && event.type !== 'notifications.changed' && event.type !== 'automations.changed' && !refreshOwn.includes(event.type)) {
        // Our own mutation: caches were updated optimistically. Still refresh items touched
        // by automations (server-side side effects) a moment later.
        if (event.type !== 'items.changed') return;
      }
      buffer.set(`${event.type}:${event.boardId ?? ''}:${event.ids.join(',')}`, event);
      if (!timer.current) timer.current = setTimeout(flush, DEBOUNCE_MS);
    };
    const onResync = () => {
      if (boardId) void queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot(orgId) });
    };

    source.addEventListener('change', onChange as EventListener);
    source.addEventListener('resync', onResync);
    return () => {
      source.removeEventListener('change', onChange as EventListener);
      source.removeEventListener('resync', onResync);
      source.close();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      buffer.clear();
    };
  }, [api, orgId, boardId, currentUserId, enabled, queryClient, refreshOwnKey]);
}
