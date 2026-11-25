'use client';
/**
 * Board card (sortable): labels, title, key, subtask progress, comments, blocked flag, CRM/WMS
 * link chips, due date (red when overdue), priority and assignee. Priority, due and assignee
 * are editable right on the card; "…" / right-click opens the task menu. Enter opens the task,
 * Space picks the card up for keyboard dragging, arrow keys move focus between cards.
 */
import { memo, type KeyboardEvent, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarPlus, CircleCheck, GitBranch, MessageSquare, MoreHorizontal, Paperclip } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Tooltip, cn } from '@/components/ui';
import { DueDate, LabelPill, PersonAvatar, PriorityIcon } from '@/components/pm';
import { PRIORITY_LABELS } from '@/lib/constants';
import type { IntegrationLinkDTO, LabelDTO, TaskSummary } from '@/lib/types';
import { AssigneePicker, DuePicker, PriorityPicker } from '@/features/views/field-pickers';
import { LazyPicker } from '@/features/views/lazy-picker';
import { LinkChips } from '@/features/views/link-chips';
import { TaskMenuItems } from '@/features/views/task-menu';
import { useCardExtras } from '@/features/views/card-extras';
import { ProjectBuildFacts } from '@/features/views/build-facts';
import type { TaskOps } from '@/features/views/use-task-ops';

export interface BoardCardProps {
  readonly id: string;
  readonly task: TaskSummary;
  readonly container: string;
  readonly labels: ReadonlyMap<string, LabelDTO>;
  readonly links: readonly IntegrationLinkDTO[] | undefined;
  readonly canEdit: boolean;
  readonly sortable: boolean;
  readonly ops: TaskOps;
  readonly onOpen: (task: TaskSummary) => void;
  readonly onNavigate: (event: KeyboardEvent<HTMLElement>, cardId: string) => boolean;
}

/** Stops clicks inside a quick-edit control from opening the task. */
function Stop({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      {children}
    </span>
  );
}

function SubtaskProgress({ done, total }: { readonly done: number; readonly total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1" title={`${done} of ${total} subtasks done`}>
      <span aria-hidden className="h-1 w-6 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <span className="block h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
      </span>
      <span className="tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}

/**
 * "No priority" on a card is empty signal bars, shown on hover as the way to set one. The shared
 * no-priority glyph is three dots, which next to the card's "..." menu read as a second menu.
 */
function EmptyPriorityIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden data-testid="card-priority-empty">
      {[0, 1, 2].map((index) => (
        <rect key={index} x={2.5 + index * 4.5} y={10.5 - index * 3} width="2" height={3 + index * 3} rx="1" fill="none" stroke="var(--border-strong)" strokeWidth="1" />
      ))}
    </svg>
  );
}

export function CardBody({ task, labels, links, ops, canEdit, interactive = true }: Pick<BoardCardProps, 'task' | 'labels' | 'links' | 'ops' | 'canEdit'> & { readonly interactive?: boolean }) {
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  const editable = canEdit && interactive;
  const extras = useCardExtras();
  const priority = (
    <span className="inline-flex size-5 items-center justify-center rounded-xs">
      {task.priority === 'none' ? <EmptyPriorityIcon /> : <PriorityIcon priority={task.priority} />}
    </span>
  );
  return (
    <>
      {task.labelIds.length ? (
        <div className="flex flex-wrap gap-1 pr-6">
          {task.labelIds.slice(0, 3).map((id) => {
            const label = labels.get(id);
            return label ? <LabelPill key={id} name={label.name} color={label.color} /> : null;
          })}
          {task.labelIds.length > 3 ? <span className="text-2xs leading-5 text-fg-muted">+{task.labelIds.length - 3}</span> : null}
        </div>
      ) : null}
      <p className={cn('line-clamp-3 pr-6 text-sm leading-5 font-medium break-words', done ? 'text-fg-secondary' : 'text-fg')}>
        {done ? <CircleCheck aria-label="Done" className="mr-1 inline size-3.5 -translate-y-px text-success" /> : null}
        {task.title}
      </p>
      {links && links.length ? <LinkChips links={links} max={2} variant="ref" wrap /> : null}
      {extras.renderCardFooter ? extras.renderCardFooter(task) : task.kind === 'build' ? <ProjectBuildFacts task={task} /> : null}
      {/* Meta on the left clips and wraps; the editable due, priority and assignee on the right never move. */}
      <div className="flex min-h-5 items-center gap-2 text-2xs text-fg-muted">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 overflow-hidden">
        <span className="shrink-0 font-key whitespace-nowrap">{task.key}</span>
        {task.subtaskCount ? <SubtaskProgress done={task.subtaskDoneCount} total={task.subtaskCount} /> : null}
        {task.commentCount ? (
          <span className="inline-flex items-center gap-0.5" title={`${task.commentCount} comments`}>
            <MessageSquare aria-hidden className="size-3" />
            {task.commentCount}
          </span>
        ) : null}
        {task.attachmentCount ? (
          <span className="inline-flex items-center gap-0.5 max-[380px]:hidden" title={`${task.attachmentCount} files`}>
            <Paperclip aria-hidden className="size-3" />
            {task.attachmentCount}
          </span>
        ) : null}
        {task.estimatePoints !== null ? (
          <span className="shrink-0 rounded-xs bg-muted px-1 font-medium whitespace-nowrap text-fg-secondary tabular-nums" title={`Estimate: ${task.estimatePoints} points`}>
            {task.estimatePoints} {task.estimatePoints === 1 ? 'pt' : 'pts'}
          </span>
        ) : null}
        {task.blockedByCount && !done ? (
          <span className="inline-flex items-center gap-0.5 font-medium text-warning-text" title="Waiting on another task">
            <GitBranch aria-hidden className="size-3" />
            Blocked
          </span>
        ) : null}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {editable ? (
            <Stop>
              <LazyPicker picker={(p) => <DuePicker value={task.dueDate} onChange={(dueDate) => void ops.updateTask(task.id, { dueDate })} {...p}>{p.trigger}</DuePicker>}>
                <button type="button" aria-label={task.dueDate ? `Due ${task.dueDate}. Change due date` : 'Add a due date'} className="inline-flex h-5 items-center rounded-xs px-0.5 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                  {task.dueDate ? <DueDate date={task.dueDate} done={done} showIcon={false} /> : <CalendarPlus aria-hidden className="size-3.5 text-icon opacity-0 transition-opacity group-hover/card:opacity-100" />}
                </button>
              </LazyPicker>
            </Stop>
          ) : (
            <DueDate date={task.dueDate} done={done} showIcon={false} />
          )}
          {task.priority !== 'none' || editable ? (
            editable ? (
              <Stop>
                <LazyPicker picker={(p) => <PriorityPicker value={task.priority} onChange={(next) => void ops.updateTask(task.id, { priority: next })} {...p}>{p.trigger}</PriorityPicker>}>
                  <button type="button" aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}. Change priority`} className={cn('rounded-xs outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus', task.priority === 'none' && 'opacity-0 transition-opacity group-hover/card:opacity-100')}>
                    {priority}
                  </button>
                </LazyPicker>
              </Stop>
            ) : (
              priority
            )
          ) : null}
          {editable ? (
            <Stop>
              <LazyPicker picker={(p) => <AssigneePicker value={task.assigneeId} onChange={(assigneeId) => void ops.updateTask(task.id, { assigneeId })} align="end" {...p}>{p.trigger}</AssigneePicker>}>
                <button type="button" aria-label="Change assignee" className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus">
                  <PersonAvatar userId={task.assigneeId} size="xs" />
                </button>
              </LazyPicker>
            </Stop>
          ) : (
            <PersonAvatar userId={task.assigneeId} size="xs" />
          )}
        </span>
      </div>
    </>
  );
}

export const BoardCard = memo(function BoardCard({ id, task, container, labels, links, canEdit, sortable, ops, onOpen, onNavigate }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'card', taskId: task.id, container },
    disabled: !canEdit,
    animateLayoutChanges: () => sortable,
  });
  const style = { transform: CSS.Translate.toString(transform), transition };
  const inside = (event: { currentTarget: EventTarget; target: EventTarget }) => (event.currentTarget as Node).contains(event.target as Node);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-roledescription="Task card. Press Enter to open, Space to pick up and move"
          aria-label={`${task.key}: ${task.title}`}
          data-testid="board-card"
          data-card-id={id}
          data-task-key={task.key}
          onPointerDown={(event) => {
            if (!inside(event)) return;
            listeners?.onPointerDown?.(event);
          }}
          onClick={(event) => {
            if (!inside(event) || event.defaultPrevented) return;
            onOpen(task);
          }}
          onKeyDown={(event) => {
            if (!inside(event)) return;
            // Ctrl/Cmd+Enter is "mark done" (shared key map), not "open".
            if (event.key === 'Enter' && !isDragging && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              onOpen(task);
              return;
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && canEdit && event.target === event.currentTarget) {
              event.preventDefault();
              void ops.deleteTasks([task.id], `Deleted ${task.key}`);
              return;
            }
            if (onNavigate(event, id)) return;
            listeners?.onKeyDown?.(event);
          }}
          className={cn(
            'group/card relative flex cursor-pointer flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3 text-left shadow-xs outline-none select-none',
            'transition-[border-color,box-shadow,opacity] duration-[var(--duration-fast)] hover:border-border-default hover:shadow-sm',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            isDragging && 'opacity-40 shadow-none',
            !isDragging && (task.statusCategory === 'done' || task.statusCategory === 'cancelled') && 'bg-[color-mix(in_srgb,var(--surface-panel),var(--surface-sunken)_50%)] opacity-80 hover:opacity-100',
            canEdit && 'touch-manipulation',
          )}
        >
          <CardBody task={task} labels={labels} links={links} ops={ops} canEdit={canEdit} />
          <span className="absolute top-2 right-2" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <Tooltip content="More actions" side="top">
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`More actions for ${task.key}`}
                    className="inline-flex size-6 items-center justify-center rounded-sm text-icon opacity-0 outline-none transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-hover data-[state=open]:opacity-100 max-md:opacity-100"
                    data-testid="card-menu"
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end" className={task.kind === 'build' ? 'w-[280px]' : 'w-56'}>
                <TaskMenuItems task={task} ops={ops} kind="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className={task.kind === 'build' ? 'w-[280px]' : 'w-56'}>
        <TaskMenuItems task={task} ops={ops} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** The floating card under the pointer while dragging. */
export function BoardCardOverlay({ task, labels, links, ops }: Pick<BoardCardProps, 'task' | 'labels' | 'links' | 'ops'>) {
  return (
    <div className="flex w-[264px] rotate-[1.5deg] cursor-grabbing flex-col gap-2 rounded-lg border border-border-default bg-panel p-3 shadow-popover">
      <CardBody task={task} labels={labels} links={links} ops={ops} canEdit={false} interactive={false} />
    </div>
  );
}

