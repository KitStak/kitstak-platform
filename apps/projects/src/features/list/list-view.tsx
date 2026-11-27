'use client';
/**
 * List: tasks grouped by section (or status, priority, assignee, label), with inline editing,
 * drag to reorder and to move between groups, subtasks nested under their task, multi-select
 * with a bulk action bar, collapsible groups, add a task in any group, and sections you can
 * add, rename and delete. Shares the filter bar and saved views with the Board and Table.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ListPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
  toast,
} from '@/components/ui';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import { compareRank } from '@/lib/rank';
import { NO_GROUP, sortTasks } from '@/lib/task-filters';
import type { TaskSummary } from '@/lib/types';
import type { GroupField } from '@/lib/view-config';
import { createSectionAction, deleteSectionAction, updateSectionAction } from '@/server/actions/structure';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShellStore } from '@/features/shell/store';
import { BulkBar } from '@/features/views/bulk-bar';
import { DisplayMenu } from '@/features/views/display-menu';
import { useGroupMeta, type GroupMeta } from '@/features/views/group-meta';
import { useTaskLinksMap } from '@/features/views/link-chips';
import { useSelection } from '@/features/views/use-selection';
import { useStoredSet } from '@/features/views/use-stored-set';
import { useTaskNav } from '@/features/views/use-task-nav';
import { useTaskOps } from '@/features/views/use-task-ops';
import { useViewState } from '@/features/views/use-view-state';
import { ViewToolbar } from '@/features/views/view-toolbar';
import { useTaskSource } from '@/features/views/task-source';
import { useCardExtras } from '@/features/views/card-extras';
import { GROUP_LABELS, LIST_GROUPS, ORDER_FIELDS, ORDER_LABELS, orderFieldOf, orderRules, type OrderField } from '@/features/views/view-state';
import { ViewCursor } from '@/features/task/view-cursor';
import { ListRow, ListRowOverlay } from './list-row';

type GroupMap = Map<string, string[]>;
const SEP = '|';
const rowId = (group: string, taskId: string) => `${group}${SEP}${taskId}`;
const taskIdOf = (id: string) => id.slice(id.lastIndexOf(SEP) + 1);
const groupDropId = (group: string) => `group${SEP}${group}`;
const groupOfDrop = (id: string) => (id.startsWith(`group${SEP}`) ? id.slice(6) : null);

function groupKeysOf(task: TaskSummary, field: GroupField): string[] {
  switch (field) {
    case 'section':
      return [task.sectionId ?? NO_GROUP];
    case 'status':
      return [task.statusId];
    case 'priority':
      return [task.priority];
    case 'assignee':
      return [task.assigneeId ?? NO_GROUP];
    case 'label':
      return task.labelIds.length ? [...task.labelIds] : [NO_GROUP];
    default:
      return ['all'];
  }
}

function containerOf(map: GroupMap, id: string): string | undefined {
  const group = groupOfDrop(id);
  if (group !== null) return group;
  for (const [key, ids] of map) if (ids.includes(id)) return key;
  return undefined;
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const row = within.find((entry) => !String(entry.id).startsWith(`group${SEP}`));
  if (row) return [row];
  const center = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => !String(container.id).startsWith(`group${SEP}`)) });
  if (within.length && center.length === 0) return within;
  return center.length ? center : within;
};

/** Add a task at the bottom of a group. */
function GroupComposer({ label, onAdd }: { readonly label: string; readonly onAdd: (title: string) => Promise<unknown> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex h-10 items-center gap-2 pr-3 pl-[52px] max-md:pl-9"
      onSubmit={(event) => {
        event.preventDefault();
        const title = value.trim();
        if (!title || busy) return;
        setBusy(true);
        setValue('');
        void onAdd(title).finally(() => setBusy(false));
      }}
    >
      <Plus aria-hidden className="size-4 shrink-0 text-icon" />
      <input
        value={value}
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setValue('');
            event.currentTarget.blur();
          }
        }}
        placeholder="Add a task"
        aria-label={label}
        className="h-8 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
        data-testid="list-add-input"
      />
      {value.trim() ? <span className="text-2xs text-fg-muted max-sm:hidden">Press Enter to add</span> : null}
    </form>
  );
}

function SectionNameInput({ initial, onSave, onCancel, label }: { readonly initial: string; readonly onSave: (name: string) => void; readonly onCancel: () => void; readonly label: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const name = value.trim();
    if (name && name !== initial) onSave(name);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      maxLength={80}
      aria-label={label}
      placeholder="Section name"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={commit}
      className="h-8 w-64 max-w-full rounded-sm border border-primary bg-panel px-2 text-sm font-semibold text-fg shadow-[0_0_0_3px_var(--focus-ring-soft)] outline-none"
    />
  );
}

interface GroupSectionProps {
  readonly groupKey: string;
  readonly meta: GroupMeta;
  readonly count: number;
  /** The title already says how many (a run summary): skip the bare count. */
  readonly hideCount?: boolean;
  readonly rowIds: readonly string[];
  readonly collapsed: boolean;
  readonly isOver: boolean;
  readonly selectedCount: number;
  readonly onToggle: () => void;
  readonly onSelectAll: (on: boolean) => void;
  readonly children: React.ReactNode;
  readonly footer: React.ReactNode;
  readonly menu: React.ReactNode;
  readonly title: React.ReactNode;
}

function GroupSection({ groupKey, meta, count, rowIds, collapsed, isOver, selectedCount, onToggle, onSelectAll, children, footer, menu, title, hideCount }: GroupSectionProps) {
  const { setNodeRef } = useDroppable({ id: groupDropId(groupKey), data: { type: 'group' } });
  const info = meta.info(groupKey);
  const all = count > 0 && selectedCount === count;
  return (
    <section ref={setNodeRef} aria-label={`${info.title}, ${count} tasks`} className="mb-4" data-testid="list-group" data-group={groupKey}>
      <div className={cn('group/header flex h-9 items-center gap-1 rounded-md pr-1 pl-1 transition-colors', isOver && collapsed && 'bg-primary-selected')}>
        <span className="flex w-6 justify-center max-md:hidden">
          {count > 0 ? (
            <Checkbox
              size="sm"
              checked={all ? true : selectedCount > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) => onSelectAll(checked === true)}
              aria-label={`Select every task in ${info.title}`}
              className={cn(selectedCount === 0 && 'opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100')}
            />
          ) : null}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
          data-testid="list-group-toggle"
        >
          {collapsed ? <ChevronRight aria-hidden className="size-4 shrink-0 text-icon" /> : <ChevronDown aria-hidden className="size-4 shrink-0 text-icon" />}
          {info.icon}
          {title}
          {hideCount ? null : <span className="font-normal text-fg-muted tabular-nums">{count}</span>}
        </button>
        <span className="ml-1 flex items-center opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100 max-md:opacity-100">{menu}</span>
      </div>
      {collapsed ? null : (
        <div className={cn('overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs transition-shadow', isOver && 'shadow-[0_0_0_2px_var(--focus-ring)]')}>
          <SortableContext id={groupDropId(groupKey)} items={rowIds as string[]} strategy={verticalListSortingStrategy}>
            <div role="rowgroup">{children}</div>
          </SortableContext>
          {footer}
        </div>
      )}
    </section>
  );
}

export function ListView() {
  const { project, statuses, statusById, labelById, capabilities } = useCurrentProject();
  const queryClient = useQueryClient();
  const tasksQuery = useTaskSource();
  const extras = useCardExtras();
  const extraFilter = extras.filter;
  const view = useViewState('list');
  const ops = useTaskOps();
  const linksByTask = useTaskLinksMap(project.key);
  const { openTask } = useTaskDrawer();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const canEdit = capabilities['task:update'];
  const canCreate = capabilities['task:create'];
  const canManage = capabilities['structure:manage'];
  const all = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const groupBy = (LIST_GROUPS as readonly string[]).includes(view.settings.groupBy) ? view.settings.groupBy : 'section';
  const fieldMeta = useGroupMeta(groupBy, all);
  const extraGrouping = extras.groupings?.find((entry) => entry.value === extras.grouping) ?? null;
  const display = extras.display;
  const extraOrder = display?.orders?.find((entry) => entry.value === display.order) ?? null;
  const noun = extras.noun?.plural ?? 'tasks';
  const order = orderFieldOf(view.settings.sort);
  const manual = !extraOrder && order === 'position';
  const collapsedGroups = useStoredSet(`ks.projects.list.collapsed.${project.id}.${groupBy}`);
  const toggledParents = useStoredSet(`ks.projects.list.subtasks.${project.id}`);
  const [dragId, setDragId] = useState<string | null>(null);
  const [live, setLive] = useState<GroupMap | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useTaskNav(listRef);

  const doneStatus = statuses.find((status) => status.category === 'done');
  const reopenStatus = statuses.find((status) => status.isDefault && status.category !== 'done') ?? statuses.find((status) => status.category === 'todo');

  // Top-level tasks pass the filter bar; subtasks are nested under their parent instead.
  const visibleTop = useMemo(() => {
    const passing = view.visible(all).filter((task) => !task.parentTaskId && (!extraFilter || extraFilter(task)));
    if (extraOrder) return [...passing].sort(extraOrder.compare);
    return sortTasks(passing, manual ? [{ field: 'position', dir: 'asc' }] : orderRules(order));
  }, [all, extraFilter, extraOrder, manual, order, view]);
  /** A page grouping (Run, Day, Variant) stands in for the field grouping; its groups never take drags. */
  const meta = useMemo<GroupMeta>(() => {
    if (!extraGrouping) return fieldMeta;
    return {
      field: 'none',
      order: extraGrouping.order(visibleTop),
      info: (key: string) => extraGrouping.info(key, visibleTop.filter((task) => extraGrouping.keyOf(task) === key)),
      move: () => null,
      createDefaults: () => ({}),
      showEmpty: false,
    };
  }, [extraGrouping, fieldMeta, visibleTop]);
  const keysOf = useCallback((task: TaskSummary) => (extraGrouping ? [extraGrouping.keyOf(task)] : groupKeysOf(task, groupBy)), [extraGrouping, groupBy]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of all) {
      if (!task.parentTaskId) continue;
      if (!view.settings.showCompleted && (task.statusCategory === 'done' || task.statusCategory === 'cancelled')) continue;
      const list = map.get(task.parentTaskId);
      if (list) list.push(task);
      else map.set(task.parentTaskId, [task]);
    }
    for (const list of map.values()) list.sort((a, b) => compareRank(a.position, b.position));
    return map;
  }, [all, view.settings.showCompleted]);
  const isExpanded = useCallback((taskId: string) => (view.settings.showSubtasks ? !toggledParents.has(taskId) : toggledParents.has(taskId)), [toggledParents, view.settings.showSubtasks]);
  const taskById = useMemo(() => new Map(all.map((task) => [task.id, task])), [all]);

  const metaOrder = meta.order;
  const metaShowEmpty = meta.showEmpty;
  const sectionCount = project.sections.length;
  const filtering = view.activeFilterCount > 0;
  const groups = useMemo(() => {
    const present = new Map<string, TaskSummary[]>();
    for (const task of visibleTop) {
      for (const key of keysOf(task)) {
        const list = present.get(key);
        if (list) list.push(task);
        else present.set(key, [task]);
      }
    }
    if (extraGrouping) return metaOrder.filter((key) => present.has(key));
    if (groupBy === 'none') return ['all'];
    return metaOrder.filter((key) => {
      if (present.has(key)) return true;
      if (filtering) return false;
      if (groupBy === 'section') return key !== NO_GROUP || sectionCount === 0;
      return metaShowEmpty && key !== NO_GROUP;
    });
  }, [extraGrouping, filtering, groupBy, keysOf, metaOrder, metaShowEmpty, sectionCount, visibleTop]);

  /** Sortable ids per group: top-level rows plus expanded subtasks right under their parent. */
  const baseIds = useMemo<GroupMap>(() => {
    const map: GroupMap = new Map(groups.map((key) => [key, []]));
    for (const task of visibleTop) {
      for (const key of keysOf(task)) {
        const ids = map.get(key);
        if (!ids) continue;
        ids.push(rowId(key, task.id));
        if (task.subtaskCount > 0 && isExpanded(task.id)) for (const child of childrenOf.get(task.id) ?? []) ids.push(rowId(key, child.id));
      }
    }
    return map;
  }, [childrenOf, groups, isExpanded, keysOf, visibleTop]);
  const shownIds = live ?? baseIds;

  const orderedTaskIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const list of baseIds.values()) for (const id of list) {
      const taskId = taskIdOf(id);
      if (!seen.has(taskId)) {
        seen.add(taskId);
        ids.push(taskId);
      }
    }
    return ids;
  }, [baseIds]);
  const selection = useSelection(orderedTaskIds);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reset = () => {
    setDragId(null);
    setLive(null);
  };
  const onDragStart = ({ active }: DragStartEvent) => {
    setDragId(String(active.id));
    setLive(new Map([...baseIds].map(([key, ids]) => [key, [...ids]])));
  };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !live) return;
    const activeId = String(active.id);
    const from = containerOf(live, activeId);
    const to = containerOf(live, String(over.id));
    if (!from || !to || from === to) return;
    setLive((current) => {
      if (!current) return current;
      const next = new Map(current);
      next.set(from, (next.get(from) ?? []).filter((id) => id !== activeId));
      const target = (next.get(to) ?? []).filter((id) => taskIdOf(id) !== taskIdOf(activeId));
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, activeId);
      next.set(to, target);
      return next;
    });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const activeId = String(active.id);
    const task = taskById.get(taskIdOf(activeId));
    if (!over || !live || !task) return reset();
    const from = containerOf(baseIds, activeId);
    const to = containerOf(live, activeId);
    if (!from || !to) return reset();
    let ids = live.get(to) ?? [];
    const overId = String(over.id);
    if (groupOfDrop(overId) === null && ids.includes(overId)) ids = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId));
    const index = ids.indexOf(activeId);
    const moved = from !== to;
    if (!moved && index === (baseIds.get(from) ?? []).indexOf(activeId)) return reset();
    if (!moved && !manual) {
      toast.info(`Rows are ordered by ${(extraOrder?.label ?? ORDER_LABELS[order]).toLowerCase()}`, `Switch “Order ${noun} by” to Manual in Display to arrange them yourself.`);
      return reset();
    }
    // Neighbours among top-level rows only (subtasks keep their own order).
    const top = ids.filter((id) => id === activeId || !taskById.get(taskIdOf(id))?.parentTaskId);
    const topIndex = top.indexOf(activeId);
    const siblings = top.filter((id) => id !== activeId).map((id) => taskById.get(taskIdOf(id))).filter((entry): entry is TaskSummary => Boolean(entry));
    const neighbours = manual ? { above: siblings[topIndex - 1] ?? null, below: siblings[topIndex] ?? null } : undefined;
    const change = moved ? meta.move(task, from, to) : { patch: {} };
    if (!change) {
      toast.info("Tasks can't be moved between these groups", 'Change the field on the task instead.');
      return reset();
    }
    void ops.applyMove(task, change, neighbours);
    reset();
  };

  const onKeyNav = useCallback((event: KeyboardEvent<HTMLElement>, id: string) => {
    const keys = ['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End'];
    if (!keys.includes(event.key)) return false;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-testid="list-row"]') ?? []);
    const index = rows.findIndex((row) => row.dataset.rowId === id);
    let target: HTMLElement | undefined;
    if (event.key === 'ArrowDown' || event.key === 'j') target = rows[index + 1];
    else if (event.key === 'ArrowUp' || event.key === 'k') target = rows[index - 1];
    else if (event.key === 'Home') target = rows[0];
    else target = rows.at(-1);
    event.preventDefault();
    target?.focus();
    if (target && event.shiftKey) selection.toggle(taskIdOf(target.dataset.rowId ?? ''), { range: true });
    return true;
  }, [selection]);

  const onSelect = useCallback((taskId: string, range: boolean) => selection.toggle(taskId, { range }), [selection]);
  const onOpen = useCallback((task: TaskSummary) => openTask(task.key), [openTask]);
  const onToggleExpand = useCallback((taskId: string) => toggledParents.toggle(taskId), [toggledParents]);
  const onAddSubtask = useCallback((task: TaskSummary) => openQuickAdd({ projectId: project.id, parentTaskId: task.id }), [openQuickAdd, project.id]);

  const invalidateProject = () => queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
  const addSection = async (name: string) => {
    setAddingSection(false);
    const result = await createSectionAction({ projectId: project.id, name });
    if (!result.ok) {
      toast.error("Couldn't add the section", result.error.message);
      return;
    }
    await invalidateProject();
    toast.success(`Added section “${result.data.name}”`);
  };
  const renameSection = async (sectionId: string, name: string) => {
    setRenaming(null);
    const result = await updateSectionAction({ sectionId, patch: { name } });
    if (!result.ok) toast.error("Couldn't rename the section", result.error.message);
    await invalidateProject();
  };
  const deleteSection = async (sectionId: string) => {
    setDeleting(null);
    const result = await deleteSectionAction({ sectionId, moveToSectionId: null });
    if (!result.ok) {
      toast.error("Couldn't delete the section", result.error.message);
      return;
    }
    await invalidateProject();
    toast.success('Section deleted', 'Its tasks are now under “No section”.');
  };

  const listKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && (event.target as HTMLElement).closest('[data-testid="list-row"]')) {
      event.preventDefault();
      selection.selectAll();
    } else if (event.key === 'Escape' && selection.count > 0) {
      selection.clear();
    }
  };

  const controls = ({ iconOnly }: { iconOnly: boolean }) => (
    <DisplayMenu
      iconOnly={iconOnly}
      summary={[extraGrouping ? `Group: ${extraGrouping.label}` : groupBy !== 'section' ? `Group: ${GROUP_LABELS[groupBy]}` : null, extraOrder ? `Order: ${extraOrder.label}` : !manual ? `Order: ${ORDER_LABELS[order].split(' (')[0]}` : null].filter(Boolean).join(' · ') || null}
      choices={[
        {
          label: 'Group by',
          value: extraGrouping ? `x:${extraGrouping.value}` : groupBy,
          options: [...(extras.groupings ?? []).map((entry) => ({ value: `x:${entry.value}`, label: entry.label })), ...LIST_GROUPS.filter((value) => !(extras.groupings && value === 'section')).map((value) => ({ value, label: GROUP_LABELS[value] ?? value }))],
          onChange: (value) => {
            if (value.startsWith('x:')) {
              extras.onGroupingChange?.(value.slice(2));
              return;
            }
            extras.onGroupingChange?.(null);
            view.setSettings({ groupBy: value as GroupField });
          },
          testId: 'group',
        },
        {
          label: `Order ${noun} by`,
          value: extraOrder ? `x:${extraOrder.value}` : order,
          options: [
            ...(display?.orders ?? []).map((entry) => ({ value: `x:${entry.value}`, label: entry.label })),
            ...ORDER_FIELDS.filter((value) => !display?.orders || value === 'position' || value === 'createdAt').map((value) => ({ value: value as string, label: ORDER_LABELS[value] })),
          ],
          onChange: (value) => {
            if (value.startsWith('x:')) {
              display?.onOrderChange?.(value.slice(2));
              return;
            }
            display?.onOrderChange?.(null);
            view.setSettings({ sort: orderRules(value as OrderField) });
          },
          testId: 'order',
        },
      ]}
      toggles={[
        ...(display?.toggles ?? []),
        { label: `Done ${noun}`, checked: view.settings.showCompleted, onChange: (checked) => view.setSettings({ showCompleted: checked }), testId: 'toggle-done' },
        { label: 'Subtasks opened', checked: view.settings.showSubtasks, onChange: (checked) => { toggledParents.set([]); view.setSettings({ showSubtasks: checked }); }, testId: 'toggle-subtasks' },
      ]}
    />
  );

  const topCount = all.filter((task) => !task.parentTaskId).length;
  const toolbar = <ViewToolbar view={view} tasks={all} shownCount={visibleTop.length} totalCount={topCount} controls={controls} controlsWidth={groupBy !== 'section' || !manual ? 200 : 100} />;

  if (tasksQuery.isLoading) {
    return (
      <div className="flex h-full flex-col" data-testid="list-view">
        {toolbar}
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-3 px-4 py-4 sm:px-6" aria-busy="true" aria-label="Loading tasks">
          <Skeleton height={20} width={160} rounded="full" />
          <div className="flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-panel">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="flex h-11 items-center gap-3 border-b border-border-subtle px-4 last:border-0">
                <Skeleton width={16} height={16} rounded="full" />
                <Skeleton height={12} width={`${60 - row * 6}%`} rounded="full" />
                <Skeleton className="ml-auto" width={80} height={12} rounded="full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <div className="flex h-full flex-col" data-testid="list-view">
        {toolbar}
        <EmptyState illustration="error" title="We couldn't load the tasks" description="Check your connection, then try again." actions={<Button onClick={() => void tasksQuery.refetch()}>Try again</Button>} />
      </div>
    );
  }

  const draggingTask = dragId ? taskById.get(taskIdOf(dragId)) : undefined;
  const overGroup = dragId && live ? containerOf(live, dragId) : undefined;
  const fromGroup = dragId ? containerOf(baseIds, dragId) : undefined;

  return (
    <div className="flex h-full flex-col" data-testid="list-view">
      {toolbar}
      <ViewCursor rootRef={listRef} mode="list" tasks={all} ops={ops} canEdit={canEdit} onOpen={onOpen} />
      <div className="min-h-0 flex-1 overflow-auto [scrollbar-width:thin] max-sm:pb-[calc(88px+env(safe-area-inset-bottom))]" onKeyDown={listKeyDown}>
        <div ref={listRef} role="grid" aria-label={`${project.name} tasks`} aria-multiselectable className="mx-auto w-full max-w-[1320px] px-4 pt-3 pb-28 sm:px-6">
          {all.length === 0 ? (
            <EmptyState
              illustration="board"
              title="No tasks yet"
              description="Add your first task below, or press C anywhere."
              actions={
                canCreate ? (
                  <Button leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ projectId: project.id })}>
                    Add a task
                  </Button>
                ) : undefined
              }
            />
          ) : visibleTop.length === 0 && view.activeFilterCount > 0 ? (
            <EmptyState
              illustration="search"
              size="sm"
              title="No tasks match these filters"
              description="Try removing a filter or searching for something else."
              actions={
                <Button variant="secondary" onClick={view.clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : null}
          {all.length > 0 ? (
            <div className="sticky top-0 z-[var(--z-sticky)] -mx-1 mb-1 hidden h-8 items-center gap-1 bg-app pr-2 pl-1 text-xs font-medium text-fg-muted md:flex" aria-hidden>
              <span className="w-[52px] shrink-0" />
              <span className="min-w-0 flex-1 pl-7">{extras.noun ? `${extras.noun.singular.charAt(0).toUpperCase()}${extras.noun.singular.slice(1)}` : 'Task'}</span>
              {extras.rowCellsHeader ?? null}
              <span className="w-32 pl-1.5 max-lg:hidden">Status</span>
              <span className="w-36 pl-1.5">Assignee</span>
              <span className="w-24 pl-1.5">Due</span>
              <span className="w-9 text-center max-sm:hidden">Priority</span>
              <span className="w-8" />
            </div>
          ) : null}
          <DndContext id={`list-${project.id}`} sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={reset}>
            {all.length > 0
              ? groups.map((groupKey) => {
                  const ids = shownIds.get(groupKey) ?? [];
                  const topIds = ids.filter((id) => !taskById.get(taskIdOf(id))?.parentTaskId);
                  const section = groupBy === 'section' && groupKey !== NO_GROUP ? project.sections.find((entry) => entry.id === groupKey) : undefined;
                  const info = meta.info(groupKey);
                  const selectedInGroup = topIds.filter((id) => selection.has(taskIdOf(id))).length;
                  const collapsed = collapsedGroups.has(groupKey);
                  return (
                    <GroupSection
                      key={groupKey}
                      groupKey={groupKey}
                      meta={meta}
                      count={topIds.length}
                      hideCount={Boolean(extraGrouping && 'meta' in info && info.meta)}
                      rowIds={ids}
                      collapsed={collapsed}
                      isOver={Boolean(dragId) && overGroup === groupKey && fromGroup !== groupKey}
                      selectedCount={selectedInGroup}
                      onToggle={() => collapsedGroups.toggle(groupKey)}
                      onSelectAll={(on) => {
                        const next = new Set(selection.ids);
                        for (const id of topIds) {
                          if (on) next.add(taskIdOf(id));
                          else next.delete(taskIdOf(id));
                        }
                        selection.set(next);
                      }}
                      title={
                        section && renaming === section.id ? (
                          <SectionNameInput initial={section.name} label="Rename section" onSave={(name) => void renameSection(section.id, name)} onCancel={() => setRenaming(null)} />
                        ) : extraGrouping ? (
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{info.title}</span>
                            {'meta' in info && info.meta ? <span className="min-w-0 truncate font-normal text-fg-secondary">{info.meta as React.ReactNode}</span> : null}
                          </span>
                        ) : (
                          <span className="truncate">{info.title}</span>
                        )
                      }
                      menu={
                        <>
                          {'actions' in info && info.actions ? (info.actions as React.ReactNode) : null}
                          {canCreate && !extras.hideCreate ? <IconButton size="sm" label={`Add a task to ${info.title}`} icon={<Plus aria-hidden />} onClick={() => openQuickAdd({ projectId: project.id, ...meta.createDefaults(groupKey) })} /> : null}
                          {section && canManage ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton size="sm" label={`${section.name} section options`} icon={<MoreHorizontal aria-hidden />} data-testid="section-menu" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-52">
                                <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setRenaming(section.id)}>
                                  Rename section
                                </DropdownMenuItem>
                                {canCreate ? (
                                  <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={() => openQuickAdd({ projectId: project.id, sectionId: section.id })}>
                                    Add a task here
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => setDeleting({ id: section.id, name: section.name, count: topIds.length })} data-testid="section-delete">
                                  Delete section
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </>
                      }
                      footer={canCreate && !extras.hideCreate ? <GroupComposer label={`Add a task to ${info.title}`} onAdd={(title) => ops.createTask({ projectId: project.id, title, at: 'bottom', ...meta.createDefaults(groupKey) }, project.key)} /> : null}
                    >
                      {ids.map((id) => {
                        const task = taskById.get(taskIdOf(id));
                        if (!task) return null;
                        const depth = task.parentTaskId ? 1 : 0;
                        return (
                          <ListRow
                            key={id}
                            id={id}
                            task={task}
                            group={groupKey}
                            depth={depth}
                            status={statusById.get(task.statusId)}
                            labels={labelById}
                            links={linksByTask.get(task.id)}
                            selected={selection.has(task.id)}
                            selectMode={selection.count > 0}
                            expanded={isExpanded(task.id)}
                            canEdit={canEdit}
                            draggable={canEdit && depth === 0}
                            doneStatusId={doneStatus?.id}
                            reopenStatusId={reopenStatus?.id}
                            ops={ops}
                            onOpen={onOpen}
                            onSelect={onSelect}
                            onToggleExpand={onToggleExpand}
                            onAddSubtask={onAddSubtask}
                            onKeyNav={onKeyNav}
                          />
                        );
                      })}
                      {ids.length === 0 ? <p className="px-4 py-3 pl-[52px] text-sm text-fg-muted max-md:pl-9">{dragId ? 'Drop here to move the task into this group.' : 'Nothing here yet.'}</p> : null}
                    </GroupSection>
                  );
                })
              : null}
            <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {draggingTask ? <ListRowOverlay task={draggingTask} status={statusById.get(draggingTask.statusId)} /> : null}
            </DragOverlay>
          </DndContext>
          {groupBy === 'section' && canManage ? (
            addingSection ? (
              <div className="mt-2 flex items-center gap-2 pl-8">
                <SectionNameInput initial="" label="New section name" onSave={(name) => void addSection(name)} onCancel={() => setAddingSection(false)} />
              </div>
            ) : (
              <Button variant="ghost" size="sm" leadingIcon={<ListPlus aria-hidden />} className="mt-1 ml-1" onClick={() => setAddingSection(true)} data-testid="add-section">
                Add section
              </Button>
            )
          ) : null}
        </div>
      </div>
      <BulkBar selection={selection} tasks={all} ops={ops} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the “${deleting?.name ?? ''}” section?`}
        description={deleting?.count ? `Its ${deleting.count} ${deleting.count === 1 ? 'task stays' : 'tasks stay'} in the project, under “No section”.` : 'This section is empty. No tasks are affected.'}
        confirmLabel="Delete section"
        destructive
        onConfirm={() => deleting && void deleteSection(deleting.id)}
      />
    </div>
  );
}
