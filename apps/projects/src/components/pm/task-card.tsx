'use client';
/** Board card: title, key, labels, due date, priority, subtasks, comments, assignee. */
import { CheckSquare, GitBranch, MessageSquare } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import type { LabelDTO, TaskSummary } from '@/lib/types';
import { DueDate } from './due-date';
import { LabelPill } from './label-pill';
import { PersonAvatar } from './person';
import { PriorityIcon } from './priority-icon';

export function TaskCard({
  task,
  labels,
  onOpen,
  dragging,
  className,
  ...rest
}: {
  readonly task: TaskSummary;
  readonly labels?: ReadonlyMap<string, LabelDTO>;
  readonly onOpen: () => void;
  readonly dragging?: boolean;
  readonly className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'>) {
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="task-card"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group flex cursor-pointer flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3 text-left shadow-xs outline-none',
        'transition-[border-color,box-shadow,opacity] hover:border-border-default hover:shadow-sm focus-visible:outline-2 focus-visible:outline-focus',
        dragging && 'opacity-40',
        className,
      )}
      {...rest}
    >
      <div className="flex items-start gap-2">
        <p className={cn('min-w-0 flex-1 text-sm leading-5 font-medium', done ? 'text-fg-muted line-through' : 'text-fg')}>{task.title}</p>
        {task.priority !== 'none' ? <PriorityIcon priority={task.priority} className="mt-0.5" /> : null}
      </div>
      {task.labelIds.length && labels ? (
        <div className="flex flex-wrap gap-1">
          {task.labelIds.slice(0, 3).map((id) => {
            const label = labels.get(id);
            return label ? <LabelPill key={id} name={label.name} color={label.color} /> : null;
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-2xs text-fg-muted">
        <span className="font-mono">{task.key}</span>
        {task.subtaskCount ? (
          <span className="inline-flex items-center gap-0.5">
            <CheckSquare aria-hidden className="size-3" />
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        ) : null}
        {task.commentCount ? (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare aria-hidden className="size-3" />
            {task.commentCount}
          </span>
        ) : null}
        {task.blockedByCount ? (
          <span className="inline-flex items-center gap-0.5 text-warning-text" title="Waiting on another task">
            <GitBranch aria-hidden className="size-3" />
            Blocked
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <DueDate date={task.dueDate} done={done} showIcon={false} />
          <PersonAvatar userId={task.assigneeId} size="xs" />
        </span>
      </div>
    </div>
  );
}
