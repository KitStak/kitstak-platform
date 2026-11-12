'use client';
/**
 * Optimistic on/off toggle shared by the board list and the org page. The switch flips in the
 * same frame as the click (cache write before any await), PATCHes for one automation are sent in
 * order, and only the newest toggle may apply the server copy or roll back (with a toast).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage, useApi, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { AutomationUsageDto } from '@/server/services/contracts/automations-center';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { centerKeys } from '../api';
import { createToggleQueue } from '../model/toggle-queue';

const queue = createToggleQueue();

/**
 * In-flight toggles win over whatever the cache says (a refetch triggered by realtime or a
 * window focus can land between two queued PATCHes); cleared when the newest one settles.
 */
let overrides: ReadonlyMap<string, boolean> = new Map();
const listeners = new Set<() => void>();
function setOverride(id: string, value: boolean | null) {
  const next = new Map(overrides);
  if (value === null) next.delete(id);
  else next.set(id, value);
  overrides = next;
  for (const listener of listeners) listener();
}
const EMPTY: ReadonlyMap<string, boolean> = new Map();

export function useEnabledOverrides(): ReadonlyMap<string, boolean> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => overrides,
    () => EMPTY,
  );
}

export function useAutomationToggle() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  return useCallback(
    (automation: Pick<AutomationDto, 'id' | 'boardId' | 'name'>, enabled: boolean) => {
      const listKey = queryKeys.boardAutomations(orgId, automation.boardId);
      const usageKey = centerKeys.usage(orgId);
      const apply = (value: boolean, server?: AutomationDto) => {
        queryClient.setQueryData<AutomationDto[]>(listKey, (list) =>
          list?.map((entry) =>
            entry.id === automation.id ? (server ?? { ...entry, enabled: value }) : entry,
          ),
        );
        queryClient.setQueryData<AutomationUsageDto>(usageKey, (data) =>
          data
            ? {
                ...data,
                automations: data.automations.map((row) =>
                  row.id === automation.id ? { ...row, enabled: value } : row,
                ),
              }
            : data,
        );
      };
      const seq = queue.begin(automation.id, !enabled);
      setOverride(automation.id, enabled);
      apply(enabled);
      void queryClient.cancelQueries({ queryKey: listKey });
      void queryClient.cancelQueries({ queryKey: usageKey });
      queue
        .enqueue(automation.id, () => api.automations.update(automation.id, { enabled }))
        .then(
          (server) => {
            queue.settle(automation.id, server.enabled);
            if (!queue.isLatest(automation.id, seq)) return;
            setOverride(automation.id, null);
            apply(server.enabled, server);
            toast.success(enabled ? 'Automation turned on' : 'Automation turned off');
          },
          (error: unknown) => {
            queue.settle(automation.id);
            if (!queue.isLatest(automation.id, seq)) return;
            setOverride(automation.id, null);
            // Roll back to what the server last confirmed (not `!enabled`: earlier queued writes
            // in this burst may have failed too), then reconcile with the server's real state.
            apply(queue.confirmed(automation.id) ?? !enabled);
            void queryClient.invalidateQueries({ queryKey: listKey });
            void queryClient.invalidateQueries({ queryKey: usageKey });
            toast.error('Couldn’t update the automation', errorMessage(error));
          },
        );
    },
    [api, orgId, queryClient],
  );
}
