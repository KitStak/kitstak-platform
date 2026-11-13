'use client';
/**
 * Compact task row for cross-project lists (Home, My Work, search results): done toggle, title
 * (opens the task drawer), key, project, labels, due date, assignee. Optimistic completion.
 */
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Paperclip } from 'lucide-react';
import { cn, toast } from '@/components/ui';
import { qk } from '@/lib/query-keys';
import type { TaskSummary } from '@/lib/types';
import { setTaskDoneAction } from '@/server/actions/tasks';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { DueDate } from './due-date';
import { PersonAvatar } from './person';
import { PriorityIcon } from './priority-icon';
import { StatusIcon } from './status-icon';

export function TaskRow({
  task,
  projectName,
  showProject = true,
  className,
}: {
  readonly task: TaskSummary;
  readonly projectName?: string;
  readonly showProject?: boolean;
  readonly className?: string;
}) {
  const { openTask } = useTaskDrawer();
  const queryClient = useQueryClient();
  const done = task.statusCategory === 'done';

  const toggle = async () => {
    const result = await setTaskDoneAction({ taskId: task.id, done: !done });
    if (!result.ok) {
      toast.error("Couldn't update that task", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'my-tasks' || (q.queryKey[0] === 'project' && q.queryKey[2] === 'tasks') });
    void queryClient.invalidateQueries({ queryKey: qk.task(task.id) });
    if (!done) {
      toast.undo(`Done: ${task.title}`, {
        onUndo: async () => {
          const undo = await setTaskDoneAction({ taskId: task.id, done: false });
          if (!undo.ok) throw new Error(undo.error.message);
          void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'my-tasks' });
        },
      });
    }
  };

  return (
    <div
      data-testid="task-row"
      className={cn(
        'group flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover focus-within:bg-hover',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-focus"
      >
        <StatusIcon category={task.statusCategory} size={16} />
      </button>
      <button
        type="button"
        onClick={() => openTask(task.key)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        <span className={cn('min-w-0 truncate text-sm', done ? 'text-fg-muted line-through' : 'text-fg')}>{task.title}</span>
        {task.subtaskCount > 0 ? (
          <span className="shrink-0 text-2xs text-fg-muted tabular-nums">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        ) : null}
        {task.commentCount > 0 ? (
          <span className="hidden shrink-0 items-center gap-0.5 text-2xs text-fg-muted sm:inline-flex">
            <MessageSquare aria-hidden className="size-3" />
            {task.commentCount}
          </span>
        ) : null}
        {task.attachmentCount > 0 ? <Paperclip aria-label="Has files" className="hidden size-3 shrink-0 text-fg-muted sm:block" /> : null}
      </button>
      {task.priority !== 'none' ? <PriorityIcon priority={task.priority} /> : null}
      {showProject ? (
        <span className="hidden max-w-36 shrink-0 truncate rounded-sm bg-sunken px-1.5 py-0.5 text-2xs font-medium text-fg-secondary md:inline" title={projectName}>
          {task.key}
        </span>
      ) : null}
      <DueDate date={task.dueDate} done={done} className="w-20 justify-end" />
      <PersonAvatar userId={task.assigneeId} size="xs" />
    </div>
  );
}
