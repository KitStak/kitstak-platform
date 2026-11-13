'use client';
/**
 * Shared state for one open task (drawer or full page): the live TaskDetail, its project,
 * permissions, an optimistic `patch()` and `refresh()` helpers. Every section reads it with
 * `useTaskContext()` instead of prop drilling.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import type { ProjectDetail, StatusDTO, TaskDetail } from '@/lib/types';
import type { TaskPatch } from '@/server/actions/tasks';

export interface TaskContextValue {
  /** The ref the detail was opened with (uuid or `OPS-42`): its query key. */
  readonly taskRef: string;
  readonly task: TaskDetail;
  readonly project: ProjectDetail;
  readonly variant: 'drawer' | 'page';
  readonly statuses: readonly StatusDTO[];
  readonly statusById: ReadonlyMap<string, StatusDTO>;
  readonly canEdit: boolean;
  readonly canComment: boolean;
  readonly canUpload: boolean;
  readonly canLogTime: boolean;
  readonly canDelete: boolean;
  readonly canCreate: boolean;
  /** Optimistic task update (detail + every cached list). Resolves false on failure (already toasted). */
  readonly patch: (patch: TaskPatch, options?: { readonly toastId?: string | number }) => Promise<boolean>;
  /** Refetch the task and everything under it (comments, activity, files, time) + lists. */
  readonly refresh: () => void;
  /** Open another task in the same surface (drawer: swaps; page: navigates). */
  readonly openTask: (key: string) => void;
  readonly onDeleted?: () => void;
  /** False once the task is being deleted: its queries stop refetching (no 404s while closing). */
  readonly live: boolean;
  /** Mark the task as going away (call right before deleting it). */
  readonly retire: () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function useTaskContext(): TaskContextValue {
  const value = useContext(TaskContext);
  if (!value) throw new Error('useTaskContext must be used inside <TaskDetailView>');
  return value;
}

export function TaskContextProvider({
  taskRef,
  task,
  project,
  variant,
  openTask,
  onDeleted,
  live,
  retire,
  children,
}: {
  readonly taskRef: string;
  readonly task: TaskDetail;
  readonly project: ProjectDetail;
  readonly variant: 'drawer' | 'page';
  readonly openTask: (key: string) => void;
  readonly onDeleted?: () => void;
  readonly live: boolean;
  readonly retire: () => void;
  readonly children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const statusById = useMemo(
    () => new Map(project.statuses.map((status) => [status.id, status])),
    [project.statuses],
  );
  const { updateTask } = useTaskMutations({ statusCategory: (id) => statusById.get(id)?.category });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['task', taskRef] });
    if (task.id !== taskRef) void queryClient.invalidateQueries({ queryKey: ['task', task.id] });
    void queryClient.invalidateQueries({ queryKey: qk.projectTasks(task.projectKey) });
    void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
  }, [queryClient, task.id, task.projectKey, taskRef]);

  const patch = useCallback(
    async (value: TaskPatch, options?: { readonly toastId?: string | number }) => {
      const key = qk.task(taskRef);
      // A refetch still in flight (from the previous edit) must not paint over this optimistic value.
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const before = queryClient.getQueryData<TaskDetail>(key);
      if (before) {
        const next: Record<string, unknown> = { ...before };
        for (const [field, fieldValue] of Object.entries(value)) {
          if (fieldValue === undefined) continue;
          next[field] =
            field === 'customFields'
              ? mergeCustom(before.customFields, fieldValue as Record<string, unknown>)
              : fieldValue;
        }
        if (value.statusId) {
          const category = statusById.get(value.statusId)?.category;
          if (category) {
            next.statusCategory = category;
            next.completedAt =
              category === 'done' || category === 'cancelled'
                ? (before.completedAt ?? new Date().toISOString())
                : null;
          }
        }
        queryClient.setQueryData(key, next as unknown as TaskDetail);
      }
      const result = await updateTask(task.id, value, options);
      if (!result) {
        if (before) queryClient.setQueryData(key, before);
        // Two quick edits can overlap: refetch so the server's value wins over any stale snapshot.
        refresh();
        return false;
      }
      refresh();
      return true;
    },
    [queryClient, refresh, statusById, task.id, taskRef, updateTask],
  );

  const capabilities = task.capabilities;
  const value = useMemo<TaskContextValue>(
    () => ({
      taskRef,
      task,
      project,
      variant,
      statuses: project.statuses,
      statusById,
      canEdit: capabilities['task:update'],
      canComment: capabilities['comment:create'],
      canUpload: capabilities['file:upload'],
      canLogTime: capabilities['time:log'],
      canDelete: capabilities['task:delete'],
      canCreate: capabilities['task:create'],
      patch,
      refresh,
      openTask,
      onDeleted,
      live,
      retire,
    }),
    [
      capabilities,
      live,
      onDeleted,
      openTask,
      patch,
      project,
      refresh,
      retire,
      statusById,
      task,
      taskRef,
      variant,
    ],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

function mergeCustom(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}
