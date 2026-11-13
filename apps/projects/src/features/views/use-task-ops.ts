'use client';
/**
 * Task operations shared by the Board, List and Table on top of useTaskMutations (optimistic,
 * rollback, undo): labels, group moves (status / section / assignee / priority / label / custom
 * field + manual position), duplicate, copy link, move to another project.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { qk } from '@/lib/query-keys';
import { rankBetween } from '@/lib/rank';
import { routes } from '@/lib/routes';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import type { TaskSummary } from '@/lib/types';
import { duplicateTaskAction, moveTaskAction, moveTaskToProjectAction, setTaskLabelsAction, updateTaskAction } from '@/server/actions/tasks';
import { useCurrentProject } from '@/features/projects/project-context';
import type { GroupMove } from './group-meta';

export function useTaskOps() {
  const { project, statusById } = useCurrentProject();
  const queryClient = useQueryClient();
  const mutations = useTaskMutations({ statusCategory: (id) => statusById.get(id)?.category });
  const tasksKey = qk.projectTasks(project.key);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
  }, [project.key, queryClient]);

  /** Replace a task's labels (optimistic). */
  const setLabels = useCallback(
    async (task: TaskSummary, labelIds: readonly string[]) => {
      const before = queryClient.getQueryData<TaskSummary[]>(tasksKey);
      queryClient.setQueryData<TaskSummary[]>(tasksKey, (list) => (Array.isArray(list) ? list.map((entry) => (entry.id === task.id ? { ...entry, labelIds: [...labelIds] } : entry)) : list));
      const result = await setTaskLabelsAction({ taskId: task.id, labelIds: [...labelIds] });
      if (!result.ok) {
        queryClient.setQueryData(tasksKey, before);
        toast.error("Couldn't change the labels", result.error.message);
        return false;
      }
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      void queryClient.invalidateQueries({ queryKey: qk.task(task.id) });
      return true;
    },
    [queryClient, tasksKey],
  );

  /**
   * Apply a group move, optionally with a manual position (neighbours in the target list).
   * The final state (status, section, lane field, labels, position) is patched into the cache
   * at once, then saved: status / section / position via moveTask, other fields via updateTask,
   * labels via setTaskLabels. Any failure rolls the cache back and explains why.
   */
  const applyMove = useCallback(
    async (task: TaskSummary, move: GroupMove, neighbours?: { above: TaskSummary | null; below: TaskSummary | null }) => {
      const statusId = move.statusId && move.statusId !== task.statusId ? move.statusId : undefined;
      const sectionId = move.sectionId !== undefined && move.sectionId !== task.sectionId ? move.sectionId : undefined;
      const position = neighbours ? rankBetween(neighbours.above?.position ?? null, neighbours.below?.position ?? null) : undefined;
      const patch = move.patch;
      const hasPatch = Object.keys(patch).length > 0;
      if (!statusId && sectionId === undefined && !position && !hasPatch && !move.labelIds) return true;

      await queryClient.cancelQueries({ queryKey: tasksKey });
      const before = queryClient.getQueryData<TaskSummary[]>(tasksKey);
      const category = statusId ? statusById.get(statusId)?.category : undefined;
      queryClient.setQueryData<TaskSummary[]>(tasksKey, (list) =>
        Array.isArray(list)
          ? list.map((entry) => {
              if (entry.id !== task.id) return entry;
              const next: Record<string, unknown> = { ...entry };
              for (const [field, value] of Object.entries(patch)) {
                if (value === undefined) continue;
                next[field] = field === 'customFields' ? { ...entry.customFields, ...(value as Record<string, unknown>) } : value;
              }
              if (statusId) {
                next.statusId = statusId;
                if (category) {
                  next.statusCategory = category;
                  next.completedAt = category === 'done' || category === 'cancelled' ? (entry.completedAt ?? new Date().toISOString()) : null;
                }
              }
              if (sectionId !== undefined) next.sectionId = sectionId;
              if (position) next.position = position;
              if (move.labelIds) next.labelIds = [...move.labelIds];
              return next as unknown as TaskSummary;
            })
          : list,
      );
      const fail = (message: string) => {
        queryClient.setQueryData(tasksKey, before);
        toast.error("Couldn't move that task", message);
        void queryClient.invalidateQueries({ queryKey: tasksKey });
        return false;
      };
      if (statusId || sectionId !== undefined || neighbours) {
        const moved = await moveTaskAction({
          taskId: task.id,
          ...(statusId ? { statusId } : {}),
          ...(sectionId !== undefined ? { sectionId } : {}),
          ...(neighbours ? { afterTaskId: neighbours.above?.id ?? null, beforeTaskId: neighbours.below?.id ?? null } : {}),
        });
        if (!moved.ok) return fail(moved.error.message);
      }
      if (hasPatch) {
        const updated = await updateTaskAction({ taskId: task.id, patch });
        if (!updated.ok) return fail(updated.error.message);
      }
      if (move.labelIds) {
        const labelled = await setTaskLabelsAction({ taskId: task.id, labelIds: [...move.labelIds] });
        if (!labelled.ok) return fail(labelled.error.message);
      }
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      void queryClient.invalidateQueries({ queryKey: qk.task(task.id) });
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      return true;
    },
    [queryClient, statusById, tasksKey],
  );

  const duplicate = useCallback(
    async (task: TaskSummary) => {
      const result = await duplicateTaskAction({ taskId: task.id, includeSubtasks: true });
      if (!result.ok) {
        toast.error("Couldn't duplicate that task", result.error.message);
        return undefined;
      }
      refresh();
      toast.success(`Made a copy: ${result.data.key}`);
      return result.data;
    },
    [refresh],
  );

  const copyLink = useCallback(async (task: TaskSummary) => {
    const url = `${window.location.origin}${routes.task(task.projectKey, task.number)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', `${task.key} · paste it anywhere to share this task.`);
    } catch {
      toast.error("Couldn't copy the link", url);
    }
  }, []);

  const moveToProject = useCallback(
    async (tasks: readonly TaskSummary[], target: { id: string; name: string }) => {
      let moved = 0;
      for (const task of tasks) {
        const result = await moveTaskToProjectAction({ taskId: task.id, projectId: target.id });
        if (!result.ok) {
          toast.error(`Couldn't move ${task.key}`, result.error.message);
          continue;
        }
        moved += 1;
      }
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['project'] });
      if (moved) toast.success(`Moved ${moved} ${moved === 1 ? 'task' : 'tasks'} to ${target.name}`);
      return moved;
    },
    [queryClient, refresh],
  );

  return { ...mutations, setLabels, applyMove, duplicate, copyLink, moveToProject, refresh } as const;
}

export type TaskOps = ReturnType<typeof useTaskOps>;
