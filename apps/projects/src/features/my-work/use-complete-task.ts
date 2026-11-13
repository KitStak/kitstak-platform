'use client';
/**
 * One-click complete / reopen for cross-project lists (My Work, Focus mode). Optimistic: every
 * cached task list flips right away, rolls back on failure, and finishing shows an Undo toast.
 */
import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { qk } from '@/lib/query-keys';
import { syncProjectProgress } from '@/lib/hooks/use-task-mutations';
import type { TaskSummary } from '@/lib/types';
import { setTaskDoneAction } from '@/server/actions/tasks';

const isTaskList = (key: readonly unknown[]) => key[0] === 'my-tasks' || (key[0] === 'project' && key[2] === 'tasks');

function patch(queryClient: QueryClient, taskId: string, done: boolean) {
  const saved = queryClient.getQueriesData<TaskSummary[]>({ predicate: (q) => isTaskList(q.queryKey) });
  const now = new Date().toISOString();
  queryClient.setQueriesData<TaskSummary[]>({ predicate: (q) => isTaskList(q.queryKey) }, (list) =>
    Array.isArray(list)
      ? list.map((task) =>
          task.id === taskId
            ? { ...task, statusCategory: done ? 'done' : 'todo', completedAt: done ? now : null, updatedAt: now }
            : task,
        )
      : list,
  );
  syncProjectProgress(queryClient);
  return () => {
    for (const [key, data] of saved) queryClient.setQueryData(key, data);
    syncProjectProgress(queryClient);
  };
}

function refresh(queryClient: QueryClient, taskId: string) {
  void queryClient.invalidateQueries({ predicate: (q) => isTaskList(q.queryKey) });
  void queryClient.invalidateQueries({ queryKey: qk.task(taskId) });
}

export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useCallback(
    async (task: TaskSummary, done: boolean, options: { readonly quiet?: boolean } = {}) => {
      const rollback = patch(queryClient, task.id, done);
      const saving = setTaskDoneAction({ taskId: task.id, done });
      // The Undo toast shows in the same frame as the check mark, not after the server answers.
      const undoId =
        done && !options.quiet
          ? toast.undo(`Marked ${task.key} done`, {
              description: task.title,
              onUndo: async () => {
                await saving;
                const undoRollback = patch(queryClient, task.id, false);
                const undo = await setTaskDoneAction({ taskId: task.id, done: false });
                if (!undo.ok) {
                  undoRollback();
                  throw new Error(undo.error.message);
                }
                refresh(queryClient, task.id);
              },
            })
          : null;
      const result = await saving;
      if (!result.ok) {
        rollback();
        if (undoId !== null) toast.forgetUndo(undoId);
        toast.error(done ? "Couldn't finish that task" : "Couldn't reopen that task", result.error.message);
        return false;
      }
      refresh(queryClient, task.id);
      return true;
    },
    [queryClient],
  );
}
