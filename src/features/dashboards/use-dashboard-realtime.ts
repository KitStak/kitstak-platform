'use client';

/**
 * Live dashboard: one SSE stream per open dashboard. Widget / layout changes made elsewhere
 * refetch the dashboard (and pulse the changed widgets with "Updated by …"); item, column and
 * group changes on the source boards refetch widget data, debounced and coalesced by the batcher.
 * Refetches wait while one of this tab's own dashboard writes is in flight so an optimistic
 * state is never overwritten by an older server copy.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { RealtimeEvent } from '@/server/realtime/events';
import { planRealtimeRefresh } from './lib/realtime';

const DASHBOARD_DEBOUNCE_MS = 300;
const DATA_DEBOUNCE_MS = 1_000;
const PULSE_MS = 2_600;
const RETRY_MS = 5_000;

export interface RemoteChange {
  readonly widgetId: string;
  readonly actorName: string;
}

export function useDashboardRealtime(options: {
  readonly orgId: string;
  readonly dashboardId: string;
  readonly userId: string;
  readonly boardIds: readonly string[];
  readonly nameOf: (userId: string | null) => string;
}): ReadonlyMap<string, string> {
  const { orgId, dashboardId, userId, boardIds, nameOf } = options;
  const queryClient = useQueryClient();
  const [pulses, setPulses] = useState<ReadonlyMap<string, string>>(() => new Map());
  const nameRef = useRef(nameOf);
  useEffect(() => {
    nameRef.current = nameOf;
  });
  const boardsKey = [...boardIds].sort().join(',');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    let dashboardTimer: number | null = null;
    let dataTimer: number | null = null;
    let retryTimer: number | null = null;
    let source: EventSource | null = null;
    let closed = false;
    const pulseTimers = new Set<number>();

    const busy = () => queryClient.isMutating({ mutationKey: ['dashboard', dashboardId] }) > 0;
    const refreshDashboard = () => {
      dashboardTimer = null;
      if (busy()) {
        dashboardTimer = window.setTimeout(refreshDashboard, DASHBOARD_DEBOUNCE_MS);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(orgId, dashboardId) });
    };
    const refreshData = () => {
      dataTimer = null;
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'widget'] });
    };
    const pulse = (widgetIds: readonly string[], actorName: string) => {
      if (widgetIds.length === 0) return;
      setPulses((current) => {
        const next = new Map(current);
        for (const id of widgetIds) next.set(id, actorName);
        return next;
      });
      const timer = window.setTimeout(() => {
        pulseTimers.delete(timer);
        setPulses((current) => {
          const next = new Map(current);
          for (const id of widgetIds) next.delete(id);
          return next;
        });
      }, PULSE_MS);
      pulseTimers.add(timer);
    };

    const handle = (event: RealtimeEvent) => {
      const plan = planRealtimeRefresh(event, { dashboardId, userId, boardIds: boardsKey ? boardsKey.split(',') : [] });
      if (plan.dashboard && dashboardTimer === null) dashboardTimer = window.setTimeout(refreshDashboard, DASHBOARD_DEBOUNCE_MS);
      if (plan.data && dataTimer === null) dataTimer = window.setTimeout(refreshData, DATA_DEBOUNCE_MS);
      if (plan.pulseWidgetIds.length) pulse(plan.pulseWidgetIds, nameRef.current(event.actorId));
    };

    const connect = () => {
      const url = buildApiUrl(`/dashboard-stream/${orgId}/${dashboardId}`, boardsKey ? { boardIds: boardsKey } : undefined);
      const next = new EventSource(url, { withCredentials: true });
      source = next;
      next.addEventListener('change', (message) => {
        try {
          handle(JSON.parse((message as MessageEvent<string>).data) as RealtimeEvent);
        } catch {
          // Malformed frame: the next event or a resync refreshes.
        }
      });
      next.addEventListener('resync', () => {
        if (dashboardTimer === null) dashboardTimer = window.setTimeout(refreshDashboard, DASHBOARD_DEBOUNCE_MS);
        if (dataTimer === null) dataTimer = window.setTimeout(refreshData, DATA_DEBOUNCE_MS);
      });
      next.addEventListener('error', () => {
        // Network blips reconnect on their own; an HTTP error closes the source for good.
        if (next.readyState !== EventSource.CLOSED || closed) return;
        next.close();
        retryTimer = window.setTimeout(connect, RETRY_MS);
      });
    };
    connect();

    return () => {
      closed = true;
      source?.close();
      for (const timer of [dashboardTimer, dataTimer, retryTimer]) if (timer !== null) window.clearTimeout(timer);
      for (const timer of pulseTimers) window.clearTimeout(timer);
    };
  }, [orgId, dashboardId, userId, boardsKey, queryClient]);

  return pulses;
}
