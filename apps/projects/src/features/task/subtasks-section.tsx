'use client';
/**
 * Subtasks: progress bar, check off, drag (or keyboard) to reorder, inline assignee and due
 * date, open in place, turn into a regular task, delete with undo, and rapid add (Enter keeps
 * the box open for the next one).
 */
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxisModifier } from './dnd-modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  CornerLeftUp,
  Eye,
  EyeOff,
  GripVertical,
  ListTree,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  ProgressBar,
  Spinner,
  Tooltip,
  cn,
} from '@/components/ui';
import { DueDate, PersonAvatar, StatusIcon } from '@/components/pm';
import { compareRank } from '@/lib/rank';
import { qk } from '@/lib/query-keys';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import type { TaskDetail, TaskSummary } from '@/lib/types';
import { createSubtaskAction, moveTaskAction } from '@/server/actions/tasks';
import { AssigneePicker, DuePicker } from '@/features/views/field-pickers';
import { toast } from '@/components/ui';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';

function SubtaskRow({
  child,
  onToggle,
  onPatch,
  onConvert,
  onDelete,
}: {
  readonly child: TaskSummary;
  readonly onToggle: (child: TaskSummary) => void;
  readonly onPatch: (
    child: TaskSummary,
    patch: { assigneeId?: string | null; dueDate?: string | null },
  ) => void;
  readonly onConvert: (child: TaskSummary) => void;
  readonly onDelete: (child: TaskSummary) => void;
}) {
  const { canEdit, canDelete, statusById, openTask } = useTaskContext();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: child.id, disabled: !canEdit });
  const done = child.statusCategory === 'done' || child.statusCategory === 'cancelled';
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/sub relative flex h-9 items-center gap-1.5 rounded-md pr-1 pl-0.5 hover:bg-hover',
        isDragging && 'z-10 bg-panel shadow-md ring-1 ring-border-subtle',
      )}
      data-testid="subtask-row"
    >
      {canEdit ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${child.title}`}
          className="inline-flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-icon opacity-0 group-hover/sub:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing"
        >
          <GripVertical aria-hidden className="size-3.5" />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onToggle(child)}
        aria-label={done ? `Mark “${child.title}” not done` : `Mark “${child.title}” done`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:bg-transparent"
      >
        <StatusIcon category={child.statusCategory} color={statusById.get(child.statusId)?.color} size={16} />
      </button>
      <button
        type="button"
        onClick={() => openTask(child.key)}
        className={cn(
          'min-w-0 flex-1 truncate rounded-xs text-left text-sm focus-visible:outline-2 focus-visible:outline-focus',
          done ? 'text-fg-muted line-through decoration-1' : 'text-fg hover:underline',
        )}
        title={child.title}
      >
        {child.title}
      </button>
      <span className="hidden shrink-0 font-mono text-2xs text-fg-muted @min-[520px]:inline">
        {child.key}
      </span>
      <DuePicker
        value={child.dueDate}
        onChange={(dueDate) => onPatch(child, { dueDate })}
        disabled={!canEdit}
        align="end"
      >
        <button
          type="button"
          disabled={!canEdit}
          className="inline-flex h-7 shrink-0 items-center rounded-sm px-1 hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus disabled:hover:bg-transparent"
          aria-label={child.dueDate ? `Due ${child.dueDate}. Change due date` : 'Set due date'}
        >
          {child.dueDate ? (
            <DueDate date={child.dueDate} done={done} />
          ) : (
            <span className="text-xs text-fg-muted opacity-0 group-hover/sub:opacity-100">Date</span>
          )}
        </button>
      </DuePicker>
      <AssigneePicker
        value={child.assigneeId}
        onChange={(assigneeId) => onPatch(child, { assigneeId })}
        disabled={!canEdit}
        align="end"
      >
        <button
          type="button"
          disabled={!canEdit}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus disabled:hover:bg-transparent"
          aria-label="Change assignee"
        >
          <PersonAvatar userId={child.assigneeId} size="xs" />
        </button>
      </AssigneePicker>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            label={`More for ${child.title}`}
            icon={<MoreHorizontal aria-hidden />}
            className="opacity-0 group-hover/sub:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem icon={<ArrowUpRight aria-hidden />} onSelect={() => openTask(child.key)}>
            Open subtask
          </DropdownMenuItem>
          {canEdit ? (
            <DropdownMenuItem
              icon={<CornerLeftUp aria-hidden />}
              onSelect={() => onConvert(child)}
              description="Moves it out of this task"
            >
              Make it a regular task
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Trash2 aria-hidden />}
                variant="danger"
                onSelect={() => onDelete(child)}
              >
                Delete subtask
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function SubtasksSection() {
  const { task, taskRef, statuses, statusById, canEdit, canCreate, refresh } = useTaskContext();
  const queryClient = useQueryClient();
  const { updateTask, deleteTasks } = useTaskMutations({
    statusCategory: (id) => statusById.get(id)?.category,
  });
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState<{ id: number; title: string }[]>([]);
  const pendingSeq = useRef(0);
  const [hideDone, setHideDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = useMemo(
    () => [...task.subtasks].sort((a, b) => compareRank(a.position, b.position)),
    [task.subtasks],
  );
  const doneCount = ordered.filter(
    (child) => child.statusCategory === 'done' || child.statusCategory === 'cancelled',
  ).length;
  const visible = hideDone
    ? ordered.filter((child) => child.statusCategory !== 'done' && child.statusCategory !== 'cancelled')
    : ordered;
  const percent = ordered.length ? Math.round((doneCount / ordered.length) * 100) : 0;
  const doneStatus = statuses.find((status) => status.category === 'done');
  const todoStatus = statuses.find((status) => status.category === 'todo') ?? statuses[0];

  const patchCache = (apply: (subtasks: readonly TaskSummary[]) => TaskSummary[]) => {
    const key = qk.task(taskRef);
    const before = queryClient.getQueryData<TaskDetail>(key);
    if (before) queryClient.setQueryData<TaskDetail>(key, { ...before, subtasks: apply(before.subtasks) });
    return () => {
      if (before) queryClient.setQueryData(key, before);
    };
  };

  const onPatch = async (child: TaskSummary, patch: Parameters<typeof updateTask>[1]) => {
    const category = patch.statusId ? statusById.get(patch.statusId)?.category : undefined;
    const rollback = patchCache((subtasks) =>
      subtasks.map((entry) =>
        entry.id === child.id
          ? ({ ...entry, ...patch, ...(category ? { statusCategory: category } : {}) } as TaskSummary)
          : entry,
      ),
    );
    const result = await updateTask(child.id, patch);
    if (!result) rollback();
    refresh();
  };

  const onToggle = (child: TaskSummary) => {
    const done = child.statusCategory === 'done' || child.statusCategory === 'cancelled';
    const target = done ? todoStatus : doneStatus;
    if (target) void onPatch(child, { statusId: target.id });
  };

  const onConvert = async (child: TaskSummary) => {
    const rollback = patchCache((subtasks) => subtasks.filter((entry) => entry.id !== child.id));
    const result = await moveTaskAction({ taskId: child.id, parentTaskId: null });
    if (!result.ok) {
      rollback();
      toast.error("Couldn't move that subtask", result.error.message);
      return;
    }
    toast.success(`${child.key} is now a regular task`);
    refresh();
  };

  const onDelete = async (child: TaskSummary) => {
    const rollback = patchCache((subtasks) => subtasks.filter((entry) => entry.id !== child.id));
    const ok = await deleteTasks([child.id], `Deleted subtask ${child.key}`);
    if (!ok) rollback();
    refresh();
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((child) => child.id === active.id);
    const to = ordered.findIndex((child) => child.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(ordered, from, to);
    const above = reordered[to - 1] ?? null;
    const below = reordered[to + 1] ?? null;
    // Keep the new order on screen until the server answers (temporary local ranks).
    const rollback = patchCache(() =>
      reordered.map((entry, index) => ({ ...entry, position: `~${String(index).padStart(4, '0')}` })),
    );
    const result = await moveTaskAction({
      taskId: String(active.id),
      afterTaskId: above?.id ?? null,
      beforeTaskId: below?.id ?? null,
    });
    if (!result.ok) {
      rollback();
      toast.error("Couldn't reorder", result.error.message);
    }
    refresh();
  };

  const add = async () => {
    const text = title.trim();
    if (!text) return;
    // Each Enter adds right away; several can be in flight while you keep typing.
    const id = (pendingSeq.current += 1);
    setPending((list) => [...list, { id, title: text }]);
    setTitle('');
    const result = await createSubtaskAction({ parentTaskId: task.id, title: text });
    if (!result.ok) {
      setPending((list) => list.filter((entry) => entry.id !== id));
      setTitle((current) => current || text);
      toast.error("Couldn't add that subtask", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: qk.task(taskRef) });
    setPending((list) => list.filter((entry) => entry.id !== id));
    refresh();
  };

  return (
    <section aria-labelledby="task-subtasks-heading" data-testid="task-subtasks">
      <SectionHeading
        id="task-subtasks-heading"
        icon={<ListTree aria-hidden />}
        count={ordered.length ? `${doneCount} of ${ordered.length} done` : undefined}
        actions={
          <>
            {doneCount > 0 && ordered.length > 3 ? (
              <IconButton
                size="sm"
                label={hideDone ? `Show done subtasks (${doneCount})` : 'Hide done subtasks'}
                icon={hideDone ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                onClick={() => setHideDone((value) => !value)}
              />
            ) : null}
            {canCreate && canEdit ? (
              <IconButton
                size="sm"
                label="Add subtask"
                icon={<Plus aria-hidden />}
                onClick={() => inputRef.current?.focus()}
              />
            ) : null}
          </>
        }
      >
        Subtasks
      </SectionHeading>
      {ordered.length ? (
        <ProgressBar
          value={percent}
          label={`${percent}% of subtasks done`}
          size="sm"
          tone="success"
          className="mt-1 mb-2"
          showValue
        />
      ) : null}
      <DndContext
        id={`subtasks-${task.id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxisModifier]}
        onDragEnd={(event) => void onDragEnd(event)}
      >
        <SortableContext items={visible.map((child) => child.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col" aria-label="Subtasks">
            {visible.map((child) => (
              <SubtaskRow
                key={child.id}
                child={child}
                onToggle={onToggle}
                onPatch={(c, p) => void onPatch(c, p)}
                onConvert={(c) => void onConvert(c)}
                onDelete={(c) => void onDelete(c)}
              />
            ))}
            {pending.map((entry) => (
              <li key={`pending-${entry.id}`} className="flex h-9 items-center gap-1.5 pl-0.5 opacity-70">
                <span className="w-4 shrink-0" />
                <span className="inline-flex size-6 items-center justify-center">
                  <Spinner size="sm" />
                </span>
                <span className="truncate text-sm text-fg">{entry.title}</span>
              </li>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {hideDone && doneCount ? (
        <button
          type="button"
          className="ml-6 text-xs text-fg-muted hover:text-fg hover:underline"
          onClick={() => setHideDone(false)}
        >
          {doneCount} done {doneCount === 1 ? 'subtask' : 'subtasks'} hidden. Show
        </button>
      ) : null}
      {canEdit && canCreate ? (
        <form
          className="mt-0.5 flex items-center gap-1.5 pl-[22px]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Plus aria-hidden className="size-4 shrink-0 text-icon" />
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && title) {
                event.stopPropagation();
                setTitle('');
              }
            }}
            placeholder={
              ordered.length
                ? 'Add another subtask'
                : 'Break this into smaller steps: type one and press Enter'
            }
            aria-label="New subtask"
            maxLength={500}
            className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-sm text-fg outline-none placeholder:text-fg-placeholder hover:bg-hover focus-visible:bg-panel focus-visible:ring-2 focus-visible:ring-focus/30"
          />
          {title.trim() ? (
            <Tooltip content="Add (Enter)">
              <button
                type="submit"
                className="h-7 shrink-0 rounded-sm bg-primary px-2.5 text-xs font-semibold text-primary-fg hover:bg-primary-hover"
              >
                Add
              </button>
            </Tooltip>
          ) : null}
        </form>
      ) : ordered.length === 0 ? (
        <p className="mt-1 text-sm text-fg-muted">No subtasks.</p>
      ) : null}
    </section>
  );
}
