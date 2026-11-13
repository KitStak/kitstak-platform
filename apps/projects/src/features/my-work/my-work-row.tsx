'use client';
/**
 * One task in My Work: one-click complete, title (opens the drawer), project, priority, a due-date
 * button that reschedules in place, and the assignee. Rows can be dragged onto another
 * when-group (Today, Upcoming, …) to reschedule.
 */
import { CalendarPlus, Check, GripVertical, MessageSquare } from 'lucide-react';
import { cn } from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import type { ProjectSummary, TaskSummary } from '@/lib/types';
import { DuePicker } from '@/features/views/field-pickers';
import { isDone } from './my-work-model';

export const TASK_DRAG_TYPE = 'application/x-kitstak-task';

export function MyWorkRow({
  task,
  project,
  showAssignee,
  showProject = true,
  active,
  onComplete,
  onOpen,
  onReschedule,
  onFocusRow,
}: {
  readonly task: TaskSummary;
  readonly project?: ProjectSummary;
  readonly showAssignee: boolean;
  readonly showProject?: boolean;
  readonly active: boolean;
  readonly onComplete: (done: boolean) => void;
  readonly onOpen: () => void;
  readonly onReschedule: (date: string | null) => void;
  readonly onFocusRow: () => void;
}) {
  const done = isDone(task);
  const canEdit = project ? project.role === 'owner' || project.role === 'editor' : true;
  return (
    <li
      data-testid="my-work-row"
      data-task-id={task.id}
      data-active={active || undefined}
      draggable={canEdit}
      onDragStart={(event) => {
        event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        event.dataTransfer.setData('text/plain', task.key);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onFocus={onFocusRow}
      className={cn(
        'group relative flex min-h-11 items-center gap-2 border-b border-border-subtle px-2 py-1.5 last:border-b-0 sm:gap-2.5 sm:pr-3',
        'hover:bg-hover focus-within:bg-hover data-[active=true]:shadow-[inset_2px_0_0_var(--color-primary)]',
      )}
    >
      <GripVertical aria-hidden className={cn('hidden size-3.5 shrink-0 text-fg-disabled opacity-0 sm:block', canEdit && 'cursor-grab group-hover:opacity-100')} />
      <button
        type="button"
        onClick={() => onComplete(!done)}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        title={done ? 'Reopen' : 'Mark done'}
        disabled={!canEdit}
        data-testid="my-work-complete"
        className="group/check relative flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed"
      >
        {done ? (
          <span className="flex size-[18px] items-center justify-center rounded-full bg-success text-primary-fg animate-pop-in">
            <Check aria-hidden className="size-3" strokeWidth={3} />
          </span>
        ) : (
          <>
            <span className="group-hover/check:opacity-0">
              <StatusIcon category={task.statusCategory} size={18} />
            </span>
            <span aria-hidden className="absolute inset-[3px] flex items-center justify-center rounded-full border-2 border-success text-success opacity-0 group-hover/check:opacity-100">
              <Check className="size-2.5" strokeWidth={3.5} />
            </span>
          </>
        )}
      </button>
      <button
        type="button"
        data-mywork-title
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className={cn('min-w-0 truncate text-sm', done ? 'text-fg-muted line-through decoration-1' : 'text-fg')}>{task.title}</span>
        {task.subtaskCount > 0 ? (
          <span className="shrink-0 rounded-sm bg-sunken px-1 text-2xs text-fg-muted tabular-nums" title={`${task.subtaskDoneCount} of ${task.subtaskCount} subtasks done`}>
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        ) : null}
        {task.commentCount > 0 ? (
          <span className="hidden shrink-0 items-center gap-0.5 text-2xs text-fg-muted sm:inline-flex" title={`${task.commentCount} comments`}>
            <MessageSquare aria-hidden className="size-3" />
            {task.commentCount}
          </span>
        ) : null}
      </button>
      {task.priority !== 'none' ? <PriorityIcon priority={task.priority} /> : null}
      {showProject ? (
        <span className="hidden max-w-44 shrink-0 items-center gap-1.5 rounded-sm px-1 text-xs text-fg-secondary md:inline-flex" title={project?.name}>
          {project ? <EntityIcon icon={project.icon} color={project.color} size={16} /> : null}
          <span className="truncate">{project?.name ?? task.projectKey}</span>
        </span>
      ) : null}
      <span className="hidden shrink-0 text-2xs font-medium text-fg-muted lg:inline">{task.key}</span>
      <DuePicker value={task.dueDate} onChange={onReschedule} align="end" disabled={!canEdit} title="Reschedule">
        <button
          type="button"
          data-testid="my-work-due"
          aria-label={task.dueDate ? `Due ${task.dueDate}. Change due date` : 'Set a due date'}
          className={cn(
            'inline-flex h-7 w-[86px] shrink-0 items-center justify-end gap-1 rounded-md px-1.5 text-xs outline-none hover:bg-pressed focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:hover:bg-transparent',
          )}
        >
          {task.dueDate ? (
            <DueDate date={task.dueDate} done={done} />
          ) : (
            <span className="inline-flex items-center gap-1 text-fg-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <CalendarPlus aria-hidden className="size-3.5" /> Add date
            </span>
          )}
        </button>
      </DuePicker>
      {showAssignee ? <PersonAvatar userId={task.assigneeId} size="xs" /> : null}
    </li>
  );
}
