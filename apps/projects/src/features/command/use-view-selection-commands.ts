'use client';
/**
 * Registers palette commands for a view's multi-selection (see selection-commands.ts). Called by
 * the bulk bar, so whatever the bar can do to the selected tasks, ⌘/Ctrl+K can do too.
 */
import { useMemo } from 'react';
import { PRIORITIES, PRIORITY_LABELS } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import type { TaskOps } from '@/features/views/use-task-ops';
import { useRegisterSelectionCommands, type SelectionCommand } from './selection-commands';

export function useViewSelectionCommands(chosen: readonly TaskSummary[], ops: TaskOps, clear: () => void): void {
  const { statuses, capabilities } = useCurrentProject();
  const { user } = useShell();
  const userId = user.id;
  const canEdit = capabilities['task:update'];
  const canDelete = capabilities['task:delete'];
  const commands = useMemo<SelectionCommand[]>(() => {
    const ids = chosen.map((task) => task.id);
    if (ids.length === 0) return [];
    const today = todayIso();
    const list: SelectionCommand[] = [];
    if (canEdit) {
      const done = statuses.find((status) => status.category === 'done');
      if (done) list.push({ id: 'done', label: 'Mark done', keywords: ['complete', 'finish', 'close'], run: () => void ops.bulkUpdate(ids, { statusId: done.id }) });
      for (const status of statuses) {
        list.push({ id: `status-${status.id}`, label: `Set status: ${status.name}`, keywords: ['status', 'move'], run: () => void ops.bulkUpdate(ids, { statusId: status.id }) });
      }
      list.push({ id: 'assign-me', label: 'Assign to me', keywords: ['assignee', 'mine', 'take'], run: () => void ops.bulkUpdate(ids, { assigneeId: userId }) });
      list.push({ id: 'unassign', label: 'Unassign', keywords: ['assignee', 'nobody'], run: () => void ops.bulkUpdate(ids, { assigneeId: null }) });
      for (const priority of PRIORITIES) {
        list.push({ id: `priority-${priority}`, label: `Set priority: ${PRIORITY_LABELS[priority]}`, keywords: ['priority'], run: () => void ops.bulkUpdate(ids, { priority }) });
      }
      list.push({ id: 'due-today', label: 'Make them due today', keywords: ['due', 'date', 'today'], run: () => void ops.bulkUpdate(ids, { dueDate: today }) });
      list.push({ id: 'due-tomorrow', label: 'Make them due tomorrow', keywords: ['due', 'date', 'tomorrow'], run: () => void ops.bulkUpdate(ids, { dueDate: addDaysIso(today, 1) }) });
      list.push({ id: 'due-clear', label: 'Clear the due date', keywords: ['due', 'date', 'remove'], run: () => void ops.bulkUpdate(ids, { dueDate: null }) });
    }
    if (canDelete) {
      list.push({
        id: 'delete',
        label: ids.length === 1 ? 'Delete the task' : `Delete ${ids.length} tasks`,
        keywords: ['remove', 'trash'],
        danger: true,
        run: () => {
          clear();
          void ops.deleteTasks(ids);
        },
      });
    }
    return list;
  }, [canDelete, canEdit, chosen, clear, ops, statuses, userId]);
  useRegisterSelectionCommands(chosen.length ? `${chosen.length} selected ${chosen.length === 1 ? 'task' : 'tasks'}` : null, commands);
}
