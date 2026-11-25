'use client';
/**
 * One List row: drag handle, select checkbox, done toggle, title (double-click to rename),
 * subtask expander, CRM/WMS chips, and inline-editable labels, status, assignee, due date and
 * priority. Right-click or "…" opens the task menu.
 */
import { memo, useState, type KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarPlus, ChevronDown, ChevronRight, GripVertical, MessageSquare, MoreHorizontal, Pencil, Plus, Tag } from 'lucide-react';
import { Checkbox, ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Tooltip, cn } from '@/components/ui';
import { DueDate, LabelPill, PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITY_LABELS } from '@/lib/constants';
import { usePeopleMap } from '@/lib/hooks/use-people';
import type { IntegrationLinkDTO, LabelDTO, StatusDTO, TaskSummary } from '@/lib/types';
import { AssigneePicker, DuePicker, LabelsPicker, PriorityPicker, StatusPicker } from '@/features/views/field-pickers';
import { InlineTitle } from '@/features/views/inline-title';
import { LazyPicker } from '@/features/views/lazy-picker';
import { LinkChip, cleanTitle } from '@/features/views/link-chips';
import { INTEGRATION_TARGET_LABELS } from '@/lib/constants';
import { CollapsingRow } from './collapsing-row';
import { TaskMenuItems } from '@/features/views/task-menu';
import { useCardExtras } from '@/features/views/card-extras';
import { toggleDoneWithUndo } from '@/features/task/done-toggle';
import type { TaskOps } from '@/features/views/use-task-ops';

export interface ListRowProps {
  readonly id: string;
  readonly task: TaskSummary;
  readonly group: string;
  readonly depth: number;
  readonly status: StatusDTO | undefined;
  readonly labels: ReadonlyMap<string, LabelDTO>;
  readonly links: readonly IntegrationLinkDTO[] | undefined;
  readonly selected: boolean;
  /** Any row is selected (phones show checkboxes only then). */
  readonly selectMode: boolean;
  readonly expanded: boolean;
  readonly canEdit: boolean;
  readonly draggable: boolean;
  readonly doneStatusId: string | undefined;
  readonly reopenStatusId: string | undefined;
  readonly ops: TaskOps;
  readonly onOpen: (task: TaskSummary) => void;
  readonly onSelect: (taskId: string, range: boolean) => void;
  readonly onToggleExpand: (taskId: string) => void;
  readonly onAddSubtask: (task: TaskSummary) => void;
  readonly onKeyNav: (event: KeyboardEvent<HTMLElement>, rowId: string) => boolean;
}

/** Stops clicks inside an inline editor from opening the task or starting a drag. */
function Cell({ className, children }: { readonly className?: string; readonly children: React.ReactNode }) {
  return (
    <div className={cn('flex shrink-0 items-center', className)} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}

const hoverAction = 'inline-flex size-6 items-center justify-center rounded-xs text-icon outline-none hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-selected';

const cellButton = 'inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-sm outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-selected disabled:pointer-events-none';

export const ListRow = memo(function ListRow(props: ListRowProps) {
  const { id, task, group, depth, status, labels, links, selected, selectMode, expanded, canEdit, draggable, ops, onOpen, onSelect, onToggleExpand, onAddSubtask, onKeyNav } = props;
  const people = usePeopleMap();
  const extras = useCardExtras();
  const extraCells = extras.renderRowCells ? extras.renderRowCells(task) : null;
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: 'row', taskId: task.id, group }, disabled: !draggable || editing });
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  const assignee = task.assigneeId ? people.get(task.assigneeId) : undefined;
  const taskLabels = task.labelIds.map((labelId) => labels.get(labelId)).filter((label): label is LabelDTO => Boolean(label));
  const realLinks = (links ?? []).filter((link) => Boolean(link.targetId));
  const chipNames = [...realLinks.map((link) => cleanTitle(link.title ?? INTEGRATION_TARGET_LABELS[link.targetType])), ...taskLabels.map((label) => label.name)];
  const chipItems = [
    ...realLinks.map((link) => <LinkChip key={link.id} link={link} variant="key" />),
    ...taskLabels.map((label) => <LabelPill key={label.id} name={label.name} color={label.color} className="max-w-none" />),
  ];
  const toggleDone = async () => {
    const target = done ? props.reopenStatusId : props.doneStatusId;
    if (!target) return;
    await toggleDoneWithUndo({ taskKey: task.key, closing: !done, target, previous: task.statusId, save: (statusId) => ops.updateTask(task.id, { statusId }) });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          role="row"
          aria-selected={selected}
          tabIndex={0}
          data-testid="list-row"
          data-row-id={id}
          data-task-key={task.key}
          onClick={(event) => {
            if (editing || event.defaultPrevented) return;
            if (event.shiftKey || event.metaKey || event.ctrlKey) {
              event.preventDefault();
              onSelect(task.id, event.shiftKey);
              return;
            }
            onOpen(task);
          }}
          onKeyDown={(event) => {
            if (editing || event.target !== event.currentTarget) return;
            // Ctrl/Cmd+Enter is "mark done" (shared key map), not "open".
            if (event.metaKey || event.ctrlKey) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              onOpen(task);
            } else if (event.key === 'x' || event.key === ' ') {
              event.preventDefault();
              onSelect(task.id, event.shiftKey);
            } else if ((event.key === 'F2' || event.key === 'e') && canEdit) {
              event.preventDefault();
              setEditing(true);
            } else if ((event.key === 'Delete' || event.key === 'Backspace') && canEdit) {
              event.preventDefault();
              void ops.deleteTasks([task.id], `Deleted ${task.key}`);
            } else onKeyNav(event, id);
          }}
          className={cn(
            'group/row relative flex h-11 cursor-pointer items-center gap-1 border-b border-border-subtle bg-panel pr-2 pl-1 text-sm outline-none last:border-b-0',
            'transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:z-[1] focus-visible:shadow-[inset_0_0_0_2px_var(--focus-ring)]',
            selected && 'bg-primary-selected hover:bg-primary-selected-hover',
            isDragging && 'z-10 opacity-60 shadow-md',
          )}
        >
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            tabIndex={-1}
            aria-label={draggable ? `Drag ${task.key} to reorder` : 'Reordering is off while sorted'}
            title={draggable ? 'Drag to move' : 'Switch the order to Manual to drag'}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'flex h-7 w-4 shrink-0 items-center justify-center rounded-xs text-icon opacity-0 transition-opacity',
              draggable ? 'cursor-grab group-hover/row:opacity-100 active:cursor-grabbing' : 'cursor-default',
              'max-md:hidden',
            )}
          >
            <GripVertical aria-hidden className="size-3.5" />
          </button>
          <Cell className={cn('w-6 justify-center', !selectMode && 'max-sm:hidden')}>
            <Checkbox
              size="sm"
              checked={selected}
              onCheckedChange={() => onSelect(task.id, false)}
              onClick={(event) => {
                if (event.shiftKey) {
                  event.preventDefault();
                  onSelect(task.id, true);
                }
              }}
              aria-label={`Select ${task.key}`}
              className={cn(!selected && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100')}
            />
          </Cell>
          <div className="relative flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: depth * 24 }}>
            {task.subtaskCount > 0 ? (
              <Cell className="w-5 justify-center">
                <button type="button" onClick={() => onToggleExpand(task.id)} aria-expanded={expanded} aria-label={expanded ? `Hide subtasks of ${task.key}` : `Show ${task.subtaskCount} subtasks of ${task.key}`} className="inline-flex size-5 items-center justify-center rounded-xs text-icon outline-none hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus">
                  {expanded ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
                </button>
              </Cell>
            ) : (
              <span aria-hidden className={cn('w-5 shrink-0', depth === 0 && 'max-sm:hidden')} />
            )}
            <Cell>
              <Tooltip content={done ? 'Reopen' : 'Mark done'} side="top">
                <button type="button" disabled={!canEdit} onClick={() => void toggleDone()} aria-label={done ? `Reopen ${task.key}` : `Mark ${task.key} done`} className="inline-flex size-6 items-center justify-center rounded-full outline-none hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none" data-testid="row-done">
                  <StatusIcon category={task.statusCategory} color={status?.color} size={16} />
                </button>
              </Tooltip>
            </Cell>
            {editing ? (
              <InlineTitle value={task.title} onSave={(title) => void ops.updateTask(task.id, { title })} onDone={() => setEditing(false)} />
            ) : (
              <>
                <span
                  onDoubleClick={(event) => {
                    if (!canEdit) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setEditing(true);
                  }}
                  className={cn('min-w-0 flex-[0_1_auto] truncate max-md:line-clamp-2 max-md:whitespace-normal', done ? 'text-fg-muted' : 'text-fg')}
                  title={task.title}
                >
                  {task.title}
                </span>
                {task.subtaskCount > 0 ? (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs leading-5 text-fg-secondary tabular-nums" title={`${task.subtaskDoneCount} of ${task.subtaskCount} subtasks done`}>
                    {task.subtaskDoneCount}/{task.subtaskCount}
                  </span>
                ) : null}
                {task.commentCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-2xs text-fg-muted max-sm:hidden" title={`${task.commentCount} comments`}>
                    <MessageSquare aria-hidden className="size-3" />
                    {task.commentCount}
                  </span>
                ) : null}
                {/* The title has first claim on the width (basis = its full text). Chips and labels
                    only get the room left over (basis 0) and fold whole chips into "+N" before the
                    title is cut; the title is cut only when even "+N" would not fit beside it. */}
                {chipItems.length ? (
                  <CollapsingRow names={chipNames} className="min-w-9 flex-[1_1_0%] max-md:hidden">
                    {chipItems}
                  </CollapsingRow>
                ) : (
                  <span aria-hidden className="min-w-0 flex-1" />
                )}
                {/* Hover actions float over the end of the title area, so they never take width
                    from the title or chips while hidden. */}
                {canEdit ? (
                  <div className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-border-subtle bg-panel px-0.5 opacity-0 shadow-sm transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 max-md:hidden">
                    <Cell>
                      <button type="button" onClick={() => setEditing(true)} aria-label={`Rename ${task.key}`} title="Rename (double-click)" className={hoverAction}>
                        <Pencil aria-hidden className="size-3.5" />
                      </button>
                    </Cell>
                    <Cell>
                      <LazyPicker disabled={!canEdit} picker={(p) => <LabelsPicker value={task.labelIds} onChange={(labelIds) => void ops.setLabels(task, labelIds)} disabled={!canEdit} align="end" {...p}>{p.trigger}</LabelsPicker>}>
                        <button type="button" aria-label="Change labels" title="Labels" className={hoverAction}>
                          <Tag aria-hidden className="size-3.5" />
                        </button>
                      </LazyPicker>
                    </Cell>
                    {depth === 0 ? (
                      <Cell>
                        <Tooltip content="Add a subtask" side="top">
                          <button type="button" onClick={() => onAddSubtask(task)} aria-label={`Add a subtask to ${task.key}`} className={hoverAction}>
                            <Plus aria-hidden className="size-3.5" />
                          </button>
                        </Tooltip>
                      </Cell>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
          {extraCells}
          <Cell className="w-32 max-lg:hidden">
            <LazyPicker disabled={!canEdit} picker={(p) => <StatusPicker value={task.statusId} onChange={(statusId) => void ops.updateTask(task.id, { statusId })} disabled={!canEdit} {...p}>{p.trigger}</StatusPicker>}>
              <button type="button" aria-label={`Status: ${status?.name ?? ''}. Change status`} className={cellButton} data-testid="row-status">
                <StatusIcon category={task.statusCategory} color={status?.color} />
                <span className="truncate text-fg-secondary">{status?.name}</span>
              </button>
            </LazyPicker>
          </Cell>
          <Cell className="w-36 max-md:w-auto">
            <LazyPicker disabled={!canEdit} picker={(p) => <AssigneePicker value={task.assigneeId} onChange={(assigneeId) => void ops.updateTask(task.id, { assigneeId })} disabled={!canEdit} align="end" {...p}>{p.trigger}</AssigneePicker>}>
              <button type="button" aria-label={assignee ? `Assigned to ${assignee.name}. Change` : 'Assign'} className={cellButton} data-testid="row-assignee">
                <PersonAvatar userId={task.assigneeId} size="xs" />
                <span className={cn('truncate max-md:hidden', assignee ? 'text-fg-secondary' : 'text-fg-muted')}>{assignee ? assignee.name : 'Unassigned'}</span>
              </button>
            </LazyPicker>
          </Cell>
          <Cell className="w-24 max-sm:w-auto">
            <LazyPicker disabled={!canEdit} picker={(p) => <DuePicker value={task.dueDate} onChange={(dueDate) => void ops.updateTask(task.id, { dueDate })} disabled={!canEdit} align="end" {...p}>{p.trigger}</DuePicker>}>
              <button type="button" aria-label={task.dueDate ? `Due ${task.dueDate}. Change` : 'Add a due date'} className={cellButton} data-testid="row-due">
                {task.dueDate ? <DueDate date={task.dueDate} done={done} /> : <CalendarPlus aria-hidden className="size-3.5 text-icon opacity-0 group-hover/row:opacity-100 max-md:opacity-60" />}
              </button>
            </LazyPicker>
          </Cell>
          <Cell className="w-9 justify-center max-sm:w-6">
            <LazyPicker disabled={!canEdit} picker={(p) => <PriorityPicker value={task.priority} onChange={(priority) => void ops.updateTask(task.id, { priority })} disabled={!canEdit} align="end" {...p}>{p.trigger}</PriorityPicker>}>
              <button type="button" aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}. Change`} title={PRIORITY_LABELS[task.priority]} className={cn(cellButton, 'justify-center px-1', task.priority === 'none' && 'opacity-40 group-hover/row:opacity-100')} data-testid="row-priority">
                <PriorityIcon priority={task.priority} />
              </button>
            </LazyPicker>
          </Cell>
          <Cell className="w-8 justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`More actions for ${task.key}`} className="inline-flex size-7 items-center justify-center rounded-sm text-icon opacity-0 outline-none group-hover/row:opacity-100 hover:bg-pressed focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:opacity-100 max-md:opacity-100" data-testid="row-menu">
                  <MoreHorizontal aria-hidden className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={task.kind === 'build' ? 'w-[280px]' : 'w-56'}>
                <TaskMenuItems task={task} ops={ops} kind="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          </Cell>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className={task.kind === 'build' ? 'w-[280px]' : 'w-56'}>
        <TaskMenuItems task={task} ops={ops} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** Floating row under the pointer while dragging. */
export function ListRowOverlay({ task, status }: { readonly task: TaskSummary; readonly status: StatusDTO | undefined }) {
  return (
    <div className="flex h-11 w-[min(640px,90vw)] cursor-grabbing items-center gap-2 rounded-md border border-border-default bg-panel px-3 text-sm shadow-popover">
      <GripVertical aria-hidden className="size-3.5 text-icon" />
      <StatusIcon category={task.statusCategory} color={status?.color} size={16} />
      <span className="truncate text-fg">{task.title}</span>
      <span className="ml-auto font-key text-2xs text-fg-muted">{task.key}</span>
    </div>
  );
}
