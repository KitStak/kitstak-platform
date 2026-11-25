'use client';
/**
 * Build and run mutations with the toasts, Undo and cache refresh every builds surface shares
 * (docs/programs/SPEC.md 5.7, 5.17). Each call returns true when it saved.
 *
 *   const actions = useBuildActions('GLOVE');
 *   await actions.update(build, { plannedQty: '120' }, 'Planned 120 kits');
 *   await actions.cancel([id1, id2]);   // toast with Undo (restore while none has new output)
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { programInvalidations } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import type { IsoDate } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import {
  cancelBuildsAction,
  copyDayAction,
  duplicateBuildAction,
  moveBuildAction,
  restoreBuildsAction,
  undoCreateBuildsAction,
  updateBuildAction,
} from '@/server/actions/builds';
import { deleteTasksAction, restoreTasksAction } from '@/server/actions/tasks';
import { cancelRunAction, copyRunAction, moveRunAction } from '@/server/actions/runs';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string; readonly code?: string } };

export interface BuildPatch {
  readonly variantId?: string | null;
  readonly buildDate?: IsoDate;
  readonly plannedQty?: string;
  readonly rateOverride?: string | null;
  readonly rateOverrideReason?: string | null;
  readonly title?: string;
  readonly assigneeId?: string | null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function useBuildActions(programKey: string) {
  const queryClient = useQueryClient();

  const refresh = useCallback(
    (extraKey?: string | null) => {
      for (const key of programInvalidations(programKey)) void queryClient.invalidateQueries({ queryKey: key });
      if (extraKey && extraKey !== programKey) for (const key of programInvalidations(extraKey)) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task'] });
    },
    [programKey, queryClient],
  );

  const settle = useCallback(
    <T>(result: Result<T>, failTitle: string): result is { ok: true; data: T } => {
      if (!result.ok) {
        toast.error(failTitle, result.error.message);
        refresh();
        return false;
      }
      refresh();
      return true;
    },
    [refresh],
  );

  const update = useCallback(
    async (build: TaskSummary, patch: BuildPatch, success?: string) => {
      const version = (build.build as { readonly version?: number } | null | undefined)?.version ?? null;
      const result = (await updateBuildAction({ taskId: build.id, patch, expectedVersion: version })) as Result<unknown>;
      if (!settle(result, `Couldn't change ${build.key}`)) return false;
      if (success) toast.success(success);
      return true;
    },
    [settle],
  );

  const cancel = useCallback(
    async (ids: readonly string[]) => {
      const result = (await cancelBuildsAction({ ids: [...ids] })) as Result<{ changed: number }>;
      if (!settle(result, "Couldn't cancel the builds")) return false;
      const changed = result.data.changed;
      toast.undo(changed === 0 ? 'Nothing to cancel' : `Cancelled ${plural(changed, 'build', 'builds')}`, {
        description: 'Logged output stays. The batch fee stops.',
        onUndo: async () => {
          const back = (await restoreBuildsAction({ ids: [...ids] })) as Result<{ changed: number }>;
          if (settle(back, "Couldn't restore the builds")) toast.success(`Restored ${plural(back.data.changed, 'build', 'builds')}`);
        },
      });
      return true;
    },
    [settle],
  );

  const remove = useCallback(
    async (ids: readonly string[], label?: string) => {
      const result = (await deleteTasksAction({ taskIds: [...ids] })) as Result<unknown>;
      if (!settle(result, "Couldn't delete the builds")) return false;
      toast.undo(label ?? `Deleted ${plural(ids.length, 'build', 'builds')}`, {
        onUndo: async () => {
          const back = (await restoreTasksAction({ taskIds: [...ids] })) as Result<unknown>;
          if (settle(back, "Couldn't bring the builds back")) toast.success(`Restored ${plural(ids.length, 'build', 'builds')}`);
        },
      });
      return true;
    },
    [settle],
  );

  const duplicate = useCallback(
    async (build: Pick<TaskSummary, 'id' | 'key'>, to: 'here' | 'tomorrow' | 'next_scheduled' | IsoDate) => {
      const result = (await duplicateBuildAction({ taskId: build.id, to })) as Result<{ id: string; key: string }>;
      if (!settle(result, `Couldn't copy ${build.key}`)) return false;
      const created = result.data;
      toast.undo(`Made ${created.key} from ${build.key}`, {
        onUndo: async () => {
          const back = (await undoCreateBuildsAction({ ids: [created.id] })) as Result<{ removed: number; kept: number }>;
          if (settle(back, "Couldn't remove the copy")) toast.success(back.data.kept ? `${created.key} was kept because it has work on it` : `Removed ${created.key}`);
        },
      });
      return true;
    },
    [settle],
  );

  const move = useCallback(
    async (build: Pick<TaskSummary, 'id' | 'key'>, toContainerKey: string, toName: string, variantId?: string | null) => {
      const result = (await moveBuildAction({ taskId: build.id, toContainerKey, variantId: variantId ?? null })) as Result<{ key: string }>;
      if (!settle(result, `Couldn't move ${build.key}`)) return false;
      refresh(toContainerKey);
      toast.success(`Moved ${build.key} to ${toName}`, `It is now ${result.data.key}.`);
      return true;
    },
    [refresh, settle],
  );

  const moveRun = useCallback(
    async (runId: string, toDate: IsoDate, text: string) => {
      const result = (await moveRunAction({ runId, key: programKey, toDate })) as Result<{ changed: number }>;
      if (!settle(result, "Couldn't move the run")) return false;
      toast.success(`Moved ${plural(result.data.changed, 'build', 'builds')} to ${text}`);
      return true;
    },
    [programKey, settle],
  );

  const copyRun = useCallback(
    async (runId: string, toDates: readonly IsoDate[]) => {
      const result = (await copyRunAction({ runId, key: programKey, toDates: [...toDates] })) as Result<{ changed: number; createdIds: string[] }>;
      if (!settle(result, "Couldn't copy the run")) return false;
      const ids = result.data.createdIds;
      toast.undo(`Made ${plural(ids.length, 'build', 'builds')} on ${plural(toDates.length, 'day', 'days')}`, {
        onUndo: async () => {
          const back = (await undoCreateBuildsAction({ ids })) as Result<{ removed: number; kept: number }>;
          if (settle(back, "Couldn't remove the copies")) toast.success(back.data.kept ? `Removed ${back.data.removed}. Kept ${back.data.kept} with work on them.` : `Removed ${plural(back.data.removed, 'build', 'builds')}`);
        },
      });
      return true;
    },
    [programKey, settle],
  );

  const cancelRun = useCallback(
    async (runId: string, buildIds: readonly string[]) => {
      const result = (await cancelRunAction({ runId, key: programKey })) as Result<{ changed: number }>;
      if (!settle(result, "Couldn't cancel the run")) return false;
      toast.undo(`Cancelled ${plural(result.data.changed, 'build', 'builds')} with no output`, {
        onUndo: async () => {
          const back = (await restoreBuildsAction({ ids: [...buildIds] })) as Result<{ changed: number }>;
          if (settle(back, "Couldn't restore the run")) toast.success(`Restored ${plural(back.data.changed, 'build', 'builds')}`);
        },
      });
      return true;
    },
    [programKey, settle],
  );

  const copyDay = useCallback(
    async (fromDate: IsoDate, toDates: readonly IsoDate[], mode: 'planned' | 'built') => {
      const result = (await copyDayAction({ key: programKey, fromDate, toDates: [...toDates], mode })) as Result<{ createdIds: string[] }>;
      if (!settle(result, "Couldn't copy the day")) return null;
      return result.data.createdIds;
    },
    [programKey, settle],
  );

  return { refresh, update, cancel, remove, duplicate, move, moveRun, copyRun, cancelRun, copyDay, invalidateTasks: () => void queryClient.invalidateQueries({ queryKey: qk.projectTasks(programKey) }) };
}

export type BuildActions = ReturnType<typeof useBuildActions>;
