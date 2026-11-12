'use client';

/**
 * The board page's single realtime subscription (the table is mounted with `realtime={false}`
 * so there is one EventSource per board tab, whatever the view type).
 *
 * Same invalidation as `useBoardStream`, plus:
 *  - view create / update / delete / reorder and board lifecycle events are applied even when
 *    they come from the signed-in user (another tab or device of the same person);
 *  - board archive / delete by someone else is remembered with the actor, so the page can say
 *    "This board was archived by Dana" instead of silently failing.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateForEvent, useApi, useOrgId } from '@/lib/hooks';
import type { RealtimeEvent } from '@/server/realtime/events';

const DEBOUNCE_MS = 150;

/** Events applied even when the current user caused them (multi-tab / multi-device). */
const ALWAYS_APPLY: ReadonlySet<RealtimeEvent['type']> = new Set([
  'views.changed',
  'board.updated',
  'board.deleted',
  'workspace.changed',
  'notifications.changed',
  'automations.changed',
  'items.changed',
]);

export interface BoardLifecycleNotice {
  /** `removed` = archived or deleted (the payload tells which once it refetches). */
  readonly kind: 'removed';
  readonly actorId: string | null;
  readonly at: string;
}

export function shouldApplyEvent(event: Pick<RealtimeEvent, 'type' | 'actorId'>, currentUserId: string | undefined): boolean {
  if (!currentUserId || event.actorId !== currentUserId) return true;
  return ALWAYS_APPLY.has(event.type);
}

export function useBoardRealtime(boardId: string, currentUserId: string | undefined): BoardLifecycleNotice | null {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<BoardLifecycleNotice | null>(null);
  const pending = useRef(new Map<string, RealtimeEvent>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
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
      if (event.boardId && event.boardId !== boardId && event.type !== 'workspace.changed' && event.type !== 'notifications.changed')
        return;
      if (!shouldApplyEvent(event, currentUserId)) return;
      if (event.type === 'board.deleted' && event.boardId === boardId && event.actorId !== currentUserId) {
        setNotice({ kind: 'removed', actorId: event.actorId, at: event.at });
      }
      if (event.type === 'board.updated' && event.boardId === boardId) setNotice(null);
      buffer.set(`${event.type}:${event.boardId ?? ''}:${event.ids.join(',')}`, event);
      if (!timer.current) timer.current = setTimeout(flush, DEBOUNCE_MS);
    };
    const onResync = () => void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'board', boardId] });
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
  }, [api, boardId, currentUserId, orgId, queryClient]);

  return notice;
}
