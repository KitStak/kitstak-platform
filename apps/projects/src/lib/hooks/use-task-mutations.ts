'use client';
/**
 * Optimistic task mutations shared by every view (board, list, table, timeline, calendar,
 * task drawer, My Work). They patch every cached task list immediately, call the server action,
 * roll back on failure (with a toast) and refetch on settle. Deletes show an Undo toast.
 */
import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { qk } from '@/lib/query-keys';
import { rankBetween } from '@/lib/rank';
import type { StatusCategory } from '@/lib/constants';
import type { TaskDetail, TaskSummary } from '@/lib/types';
import {
  bulkUpdateTasksAction,
  createTaskAction,
  deleteTasksAction,
  moveTaskAction,
  restoreTasksAction,
  updateTaskAction,
  type CreateTaskActionInput,
  type MoveTaskActionInput,
  type TaskPatch,
} from '@/server/actions/tasks';

type Snapshot = [readonly unknown[], unknown][];

/** Every cached query that holds TaskSummary[] (project lists, My Work). */
function taskListPredicate(key: readonly unknown[]): boolean {
  return (key[0] === 'project' && key[2] === 'tasks') || key[0] === 'my-tasks';
}

function snapshot(queryClient: QueryClient): Snapshot {
  return queryClient
    .getQueriesData({ predicate: (query) => taskListPredicate(query.queryKey) || query.queryKey[0] === 'task' })
    .map(([key, data]) => [key, data]);
}

function restore(queryClient: QueryClient, saved: Snapshot): void {
  for (const [key, data] of saved) queryClient.setQueryData(key, data);
}

function patchLists(queryClient: QueryClient, ids: ReadonlySet<string>, apply: (task: TaskSummary) => TaskSummary | null): void {
  queryClient.setQueriesData<TaskSummary[]>({ predicate: (query) => taskListPredicate(query.queryKey) }, (list) => {
    if (!Array.isArray(list)) return list;
    const out: TaskSummary[] = [];
    for (const task of list) {
      if (!ids.has(task.id)) {
        out.push(task);
        continue;
      }
      const next = apply(task);
      if (next) out.push(next);
    }
    return out;
  });
  for (const id of ids) {
    queryClient.setQueryData<TaskDetail>(qk.task(id), (detail) => {
      if (!detail) return detail;
      const next = apply(detail);
      return next ? ({ ...detail, ...next } as TaskDetail) : detail;
    });
  }
}

/**
 * Fired on `window` right before tasks are deleted (detail: `{ ids }`), so an open task drawer or
 * page showing one of them can close instead of reloading a task that is gone.
 */
export const TASKS_DELETED_EVENT = 'kitstak:tasks-deleted';

function invalidateTasks(queryClient: QueryClient, ids: readonly string[] = []): void {
  void queryClient.invalidateQueries({ predicate: (query) => taskListPredicate(query.queryKey) });
  for (const id of ids) void queryClient.invalidateQueries({ queryKey: qk.task(id) });
  void queryClient.invalidateQueries({ queryKey: ['project'] , predicate: (query) => query.queryKey.length === 2 });
}

/** Optional status → category lookup so optimistic status moves update the category too. */
export type StatusCategoryLookup = (statusId: string) => StatusCategory | undefined;

export function useTaskMutations(options: { readonly statusCategory?: StatusCategoryLookup } = {}) {
  const queryClient = useQueryClient();
  const { statusCategory } = options;

  const applyPatch = useCallback(
    (task: TaskSummary, patch: TaskPatch): TaskSummary => {
      const next = { ...task } as Record<string, unknown>;
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined || field === 'description' || field === 'recurrence') continue;
        if (field === 'customFields') {
          next.customFields = { ...task.customFields, ...(value as Record<string, unknown>) };
          continue;
        }
        next[field] = value;
      }
      if (patch.statusId && statusCategory) {
        const category = statusCategory(patch.statusId);
        if (category) {
          next.statusCategory = category;
          next.completedAt = category === 'done' || category === 'cancelled' ? (task.completedAt ?? new Date().toISOString()) : null;
        }
      }
      next.updatedAt = new Date().toISOString();
      return next as unknown as TaskSummary;
    },
    [statusCategory],
  );

  /** Patch one task. Resolves to the server's TaskSummary, or undefined on failure (already toasted). */
  const updateTask = useCallback(
    async (taskId: string, patch: TaskPatch): Promise<TaskSummary | undefined> => {
      await queryClient.cancelQueries({ predicate: (query) => taskListPredicate(query.queryKey) });
      const saved = snapshot(queryClient);
      patchLists(queryClient, new Set([taskId]), (task) => applyPatch(task, patch));
      const result = await updateTaskAction({ taskId, patch });
      if (!result.ok) {
        restore(queryClient, saved);
        toast.error("Couldn't save your change", result.error.message);
        return undefined;
      }
      patchLists(queryClient, new Set([taskId]), () => result.data);
      invalidateTasks(queryClient, [taskId]);
      return result.data;
    },
    [applyPatch, queryClient],
  );

  /** Same patch on many tasks (multi-select). */
  const bulkUpdate = useCallback(
    async (taskIds: readonly string[], patch: TaskPatch & { addLabelIds?: string[]; removeLabelIds?: string[] }) => {
      const saved = snapshot(queryClient);
      const { addLabelIds, removeLabelIds, ...fields } = patch;
      patchLists(queryClient, new Set(taskIds), (task) => {
        const next = applyPatch(task, fields);
        if (!addLabelIds?.length && !removeLabelIds?.length) return next;
        const labels = new Set(next.labelIds);
        for (const id of addLabelIds ?? []) labels.add(id);
        for (const id of removeLabelIds ?? []) labels.delete(id);
        return { ...next, labelIds: [...labels] };
      });
      const result = await bulkUpdateTasksAction({ taskIds: [...taskIds], patch });
      if (!result.ok) {
        restore(queryClient, saved);
        toast.error("Couldn't update those tasks", result.error.message);
        return undefined;
      }
      invalidateTasks(queryClient, taskIds);
      toast.success(`Updated ${taskIds.length} ${taskIds.length === 1 ? 'task' : 'tasks'}`);
      return result.data;
    },
    [applyPatch, queryClient],
  );

  /**
   * Drag and drop. `neighbours` are the tasks directly above/below the drop spot in the view;
   * the optimistic position is computed with the same rank function the server uses.
   */
  const moveTask = useCallback(
    async (
      input: MoveTaskActionInput,
      neighbours: { readonly above?: TaskSummary | null; readonly below?: TaskSummary | null } = {},
    ) => {
      const saved = snapshot(queryClient);
      const position =
        neighbours.above !== undefined || neighbours.below !== undefined
          ? rankBetween(neighbours.above?.position ?? null, neighbours.below?.position ?? null)
          : undefined;
      patchLists(queryClient, new Set([input.taskId]), (task) => {
        const next = applyPatch(task, {
          ...(input.statusId ? { statusId: input.statusId } : {}),
          ...(input.sectionId !== undefined ? { sectionId: input.sectionId } : {}),
        });
        return {
          ...next,
          ...(position ? { position } : {}),
          ...(input.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
        };
      });
      const result = await moveTaskAction({
        ...input,
        afterTaskId: input.afterTaskId ?? (neighbours.above ? neighbours.above.id : neighbours.above === null ? null : undefined),
        beforeTaskId: input.beforeTaskId ?? (neighbours.below ? neighbours.below.id : neighbours.below === null ? null : undefined),
      });
      if (!result.ok) {
        restore(queryClient, saved);
        toast.error("Couldn't move that task", result.error.message);
        return undefined;
      }
      patchLists(queryClient, new Set([input.taskId]), () => result.data.task);
      invalidateTasks(queryClient, [input.taskId]);
      return result.data;
    },
    [applyPatch, queryClient],
  );

  /** Create a task; inserts it into cached lists of that project right away. */
  const createTask = useCallback(
    async (input: CreateTaskActionInput, projectKey?: string) => {
      const result = await createTaskAction(input);
      if (!result.ok) {
        toast.error("Couldn't add that task", result.error.message);
        return undefined;
      }
      if (projectKey) {
        queryClient.setQueryData<TaskSummary[]>(qk.projectTasks(projectKey), (list) => (Array.isArray(list) ? [...list, result.data] : list));
      }
      invalidateTasks(queryClient);
      return result.data;
    },
    [queryClient],
  );

  /** Delete with an Undo toast (restores every deleted id incl. subtasks). */
  const deleteTasks = useCallback(
    async (taskIds: readonly string[], label?: string) => {
      const saved = snapshot(queryClient);
      patchLists(queryClient, new Set(taskIds), () => null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(TASKS_DELETED_EVENT, { detail: { ids: [...taskIds] } }));
      }
      const result = await deleteTasksAction({ taskIds: [...taskIds] });
      if (!result.ok) {
        restore(queryClient, saved);
        toast.error("Couldn't delete that", result.error.message);
        return false;
      }
      invalidateTasks(queryClient, taskIds);
      toast.undo(label ?? (taskIds.length === 1 ? 'Task deleted' : `${taskIds.length} tasks deleted`), {
        onUndo: async () => {
          const undo = await restoreTasksAction({ taskIds: result.data });
          if (!undo.ok) throw new Error(undo.error.message);
          invalidateTasks(queryClient, result.data);
          toast.success('Restored');
        },
      });
      return true;
    },
    [queryClient],
  );

  return { updateTask, bulkUpdate, moveTask, createTask, deleteTasks } as const;
}
