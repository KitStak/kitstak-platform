'use client';
/**
 * Delete with Undo. The delete is committed on the server right away (a soft delete, which also
 * stops the engine), so reloading or leaving the page can never bring the automation back.
 * Undo calls the restore endpoint with the automation's previous on/off state.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { errorMessage, useApi, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { centerKeys } from '../api';

export const UNDO_WINDOW_MS = 8_000;

function byCreated(a: AutomationDto, b: AutomationDto): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function useDeferredDelete(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = queryKeys.boardAutomations(orgId, boardId);
  /** Ids whose DELETE is still in flight: hidden even if a refetch started earlier returns them. */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const setPendingId = useCallback((id: string, on: boolean) => {
    setPending((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const putBack = useCallback(
    (automation: AutomationDto) =>
      queryClient.setQueryData<AutomationDto[]>(key, (list) =>
        list && !list.some((entry) => entry.id === automation.id)
          ? [...list, automation].sort(byCreated)
          : list,
      ),
    [key, queryClient],
  );

  const restore = useCallback(
    async (automation: AutomationDto) => {
      try {
        const restored = await apiRequest<AutomationDto>(
          `/automation-center/automations/${automation.id}/restore`,
          { orgId, method: 'POST', body: {} },
        );
        putBack(restored);
        toast.success('Automation restored');
      } catch (error) {
        toast.error('Couldn’t restore the automation', errorMessage(error));
      } finally {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: centerKeys.usage(orgId) });
      }
    },
    [key, orgId, putBack, queryClient],
  );

  const schedule = useCallback(
    (automation: AutomationDto) => {
      setPendingId(automation.id, true);
      void queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<AutomationDto[]>(key, (list) =>
        list?.filter((entry) => entry.id !== automation.id),
      );
      const request = api.automations.remove(automation.id);
      toast.undo('Automation deleted', {
        description: automation.name,
        duration: UNDO_WINDOW_MS,
        onUndo: () => {
          // Restore only once the delete landed, so the two requests can't cross.
          void request.then(
            () => restore(automation),
            () => undefined,
          );
        },
      });
      request.then(
        () => {
          setPendingId(automation.id, false);
          void queryClient.invalidateQueries({ queryKey: centerKeys.usage(orgId) });
        },
        (error: unknown) => {
          setPendingId(automation.id, false);
          putBack(automation);
          toast.error('Couldn’t delete the automation', errorMessage(error));
        },
      );
    },
    [api, key, orgId, putBack, queryClient, restore, setPendingId],
  );

  return { pending, schedule };
}
