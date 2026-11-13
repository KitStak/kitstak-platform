'use client';
/**
 * "No dates" tray shared by the Timeline and Calendar: tasks without a start or due date. Drag one
 * onto the grid to schedule it, or use the calendar button. The Calendar also lets you drop a task
 * here to clear its dates.
 */
import { useState } from 'react';
import { CalendarPlus, Inbox, X } from 'lucide-react';
import { EmptyState, IconButton, cn } from '@/components/ui';
import { PersonAvatar, StatusIcon } from '@/components/pm';
import type { TaskSummary } from '@/lib/types';

/** dataTransfer type carrying a task id between the tray and the grids. */
export const TASK_MIME = 'application/x-kitstak-task';

export function UnscheduledTray({
  tasks,
  canEdit,
  onClose,
  onOpen,
  onSchedule,
  statusColor,
  scheduleLabel = 'starting today',
  onDropTask,
}: {
  readonly tasks: readonly TaskSummary[];
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onOpen: (key: string) => void;
  readonly onSchedule: (task: TaskSummary) => void;
  readonly statusColor: (task: TaskSummary) => string | undefined;
  /** Words after "Give <task> dates …" on the calendar button. */
  readonly scheduleLabel?: string;
  /** When set, dropping a scheduled task here calls it (e.g. to clear its dates). */
  readonly onDropTask?: (taskId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <aside
      id="timeline-tray"
      aria-label="Tasks with no dates"
      data-testid="unscheduled-tray"
      onDragOver={(event) => {
        if (!onDropTask || !canEdit || !event.dataTransfer.types.includes(TASK_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        const id = event.dataTransfer.getData(TASK_MIME);
        if (!onDropTask || !id) return;
        event.preventDefault();
        onDropTask(id);
      }}
      className={cn(
        'absolute inset-y-0 right-0 z-[var(--z-header)] flex w-[min(320px,88vw)] flex-col border-l border-border-subtle bg-panel shadow-lg transition-colors sm:static sm:z-auto sm:w-80 sm:shadow-none',
        over && 'bg-primary-subtle',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <Inbox aria-hidden className="size-4 text-icon" />
        <h2 className="flex-1 text-sm font-semibold text-fg">
          No dates <span className="font-normal text-fg-muted tabular-nums">· {tasks.length}</span>
        </h2>
        <IconButton size="sm" label="Close the no dates list" icon={<X aria-hidden />} onClick={onClose} />
      </header>
      {tasks.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="board"
          title="Everything is scheduled"
          description={onDropTask && canEdit ? 'Every task you can see has a date. Drop a task here to clear its dates.' : 'Every task you can see has a start or due date.'}
        />
      ) : (
        <>
          <p className="px-4 pt-3 pb-1 text-xs text-fg-muted">
            {canEdit ? `Drag a task onto the ${onDropTask ? 'calendar' : 'timeline'} to give it a date.` : 'These tasks don’t have dates yet.'}
          </p>
          <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
            {tasks.map((task) => (
              <li
                key={task.id}
                draggable={canEdit}
                data-testid="tray-task"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(TASK_MIME, task.id);
                  event.dataTransfer.setData('text/plain', task.key);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-border-subtle bg-panel px-2.5 py-2 shadow-xs transition-shadow hover:shadow-sm',
                  canEdit && 'cursor-grab active:cursor-grabbing',
                )}
              >
                <StatusIcon category={task.statusCategory} color={statusColor(task)} />
                <button type="button" onClick={() => onOpen(task.key)} className="min-w-0 flex-1 rounded-xs text-left focus-visible:outline-2 focus-visible:outline-focus">
                  <span className="block truncate text-sm text-fg">{task.title}</span>
                  <span className="block text-2xs text-fg-muted">{task.key}</span>
                </button>
                <PersonAvatar userId={task.assigneeId} size="xs" />
                {canEdit ? <IconButton size="xs" label={`Give ${task.title} a date ${scheduleLabel}`} icon={<CalendarPlus aria-hidden />} onClick={() => onSchedule(task)} /> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
