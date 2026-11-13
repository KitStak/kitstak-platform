'use client';
/**
 * Board (Kanban): one column per workflow status with counts and work-in-progress limits;
 * drag cards between columns and to reorder (dnd-kit; optimistic; saved as a fractional rank);
 * swimlanes by assignee, priority or label; add a task right inside a column; collapse columns
 * and lanes; filter bar + saved views; full keyboard support with screen-reader announcements.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDroppable,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, KanbanSquare, Plus } from 'lucide-react';
import { Button, EmptyState, Skeleton, cn, toast } from '@/components/ui';
import { PRIORITY_LABELS } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import { useProjectTasks } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import { NO_GROUP, sortTasks } from '@/lib/task-filters';
import type { IntegrationLinkDTO, TaskSummary } from '@/lib/types';
import { updateStatusAction } from '@/server/actions/structure';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShellStore } from '@/features/shell/store';
import { DisplayMenu } from '@/features/views/display-menu';
import { useGroupMeta } from '@/features/views/group-meta';
import { useTaskLinksMap } from '@/features/views/link-chips';
import { useStoredSet } from '@/features/views/use-stored-set';
import { useTaskNav } from '@/features/views/use-task-nav';
import { useTaskOps } from '@/features/views/use-task-ops';
import { useViewState } from '@/features/views/use-view-state';
import { ViewToolbar } from '@/features/views/view-toolbar';
import { GROUP_LABELS, ORDER_FIELDS, ORDER_LABELS, orderFieldOf, orderRules, SWIMLANES, type OrderField, type Swimlane } from '@/features/views/view-state';
import { ViewCursor } from '@/features/task/view-cursor';
import { LinkFilterBar, hasLinkLane, linkLaneKeys, useLinkFilter, useLinkLaneMeta } from '@/features/integrations/link-lanes';
import { BoardCard, BoardCardOverlay } from './board-card';
import { BoardComposer } from './board-composer';
import { BoardCell, COLLAPSED_WIDTH, COLUMN_WIDTH, CollapsedColumn, ColumnHeader } from './board-column';

type ContainerMap = Map<string, string[]>;

const SEP = '|';
const cellId = (lane: string, statusId: string) => `cell${SEP}${lane}${SEP}${statusId}`;
const cardId = (lane: string, taskId: string) => `${lane}${SEP}${taskId}`;
const taskIdOf = (id: string) => id.slice(id.lastIndexOf(SEP) + 1);
function parseCell(id: string): { lane: string; statusId: string } {
  const [, lane = 'all', statusId = ''] = id.split(SEP);
  return { lane, statusId };
}

function containerOf(map: ContainerMap, id: string): string | undefined {
  if (id.startsWith(`cell${SEP}`)) return id;
  for (const [container, ids] of map) if (ids.includes(id)) return container;
  return undefined;
}

function laneKeysOf(task: TaskSummary, lane: Swimlane, linksByTask: ReadonlyMap<string, readonly IntegrationLinkDTO[]>): string[] {
  switch (lane) {
    case 'crm':
    case 'wms':
      return linkLaneKeys(task, lane, linksByTask);
    case 'assignee':
      return [task.assigneeId ?? NO_GROUP];
    case 'priority':
      return [task.priority];
    case 'label':
      return task.labelIds.length ? [...task.labelIds] : [NO_GROUP];
    default:
      return ['all'];
  }
}

/** Prefer the container under the pointer; fall back to the nearest corners (keyboard, gaps). */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) {
    const card = within.find((entry) => !String(entry.id).startsWith(`cell${SEP}`));
    return card ? [card] : within;
  }
  return closestCorners(args);
};

/** Edge fades + scroll buttons when the columns overflow horizontally. */
function useHorizontalOverflow() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    if (!node) return;
    const update = () => {
      const left = node.scrollLeft > 4;
      const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 4;
      setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [node]);
  const scrollBy = (direction: 1 | -1) => node?.scrollBy({ left: direction * Math.max(296, node.clientWidth * 0.7), behavior: 'smooth' });
  return { attach: setNode, edges, scrollBy };
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the board" className="flex flex-1 gap-3 overflow-hidden p-4 sm:px-6">
      {[0, 1, 2, 3].map((column) => (
        <div key={column} className={cn('flex shrink-0 flex-col gap-2 rounded-xl bg-sunken p-2', COLUMN_WIDTH)}>
          <Skeleton height={24} width="55%" rounded="full" />
          {[0, 1, 2].slice(0, 3 - (column % 2)).map((card) => (
            <div key={card} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3">
              <Skeleton height={12} width={`${80 - card * 15}%`} rounded="full" />
              <Skeleton height={10} width="40%" rounded="full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const RECENT_DONE_DAYS = 14;

export function BoardView() {
  const { project, statuses, statusById, labelById, capabilities } = useCurrentProject();
  const queryClient = useQueryClient();
  const tasksQuery = useProjectTasks(project.key);
  const view = useViewState('board');
  const ops = useTaskOps();
  const linksByTask = useTaskLinksMap(project.key);
  const { openTask } = useTaskDrawer();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const canEdit = capabilities['task:update'];
  const canCreate = capabilities['task:create'];
  const canManage = capabilities['structure:manage'];
  const all = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const order = orderFieldOf(view.settings.sort);
  const manual = order === 'position';
  const lane = view.settings.swimlane;
  const fieldLaneMeta = useGroupMeta(lane === 'none' || lane === 'crm' || lane === 'wms' ? 'none' : lane, all);
  const linkLaneMeta = useLinkLaneMeta(lane, linksByTask);
  const linkFilter = useLinkFilter(linksByTask);
  const laneMeta = linkLaneMeta ?? fieldLaneMeta;
  const storedCollapsed = useStoredSet(`ks.projects.board.collapsed.${project.id}`);
  const expandedColumns = useStoredSet(`ks.projects.board.expanded.${project.id}`);
  const boardPrefs = useStoredSet(`ks.projects.board.prefs.${project.id}`);
  const recentDoneOnly = boardPrefs.has('recent-done');
  const collapsedLanes = useStoredSet(`ks.projects.board.lanes.${project.id}.${lane}`);
  const [composer, setComposer] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [live, setLive] = useState<ContainerMap | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const boardRef = useRef<HTMLDivElement>(null);
  useTaskNav(boardRef, { enabled: dragId === null });

  const visible = useMemo(() => {
    let shown = view.visible(all);
    if (linkFilter.key) shown = shown.filter((task) => linkFilter.matches(task));
    if (recentDoneOnly) {
      // "Done in the last 14 days": older finished work leaves the board but stays in List and Table.
      const cutoff = addDaysIso(todayIso(), -RECENT_DONE_DAYS);
      shown = shown.filter((task) => !(task.statusCategory === 'done' || task.statusCategory === 'cancelled') || !task.completedAt || task.completedAt.slice(0, 10) >= cutoff);
    }
    return sortTasks(shown, manual ? [{ field: 'position', dir: 'asc' }] : orderRules(order));
  }, [all, linkFilter, manual, order, recentDoneOnly, view]);
  const taskById = useMemo(() => new Map(all.map((task) => [task.id, task])), [all]);

  const lanes = useMemo<string[]>(() => {
    if (lane === 'none') return ['all'];
    const present = new Set<string>();
    for (const task of visible) for (const key of laneKeysOf(task, lane, linksByTask)) present.add(key);
    const keys = laneMeta.order.filter((key) => present.has(key));
    return keys.length ? keys : [];
  }, [lane, laneMeta.order, linksByTask, visible]);

  const baseIds = useMemo<ContainerMap>(() => {
    const map: ContainerMap = new Map();
    for (const laneKey of lanes) for (const status of statuses) map.set(cellId(laneKey, status.id), []);
    for (const task of visible) {
      for (const laneKey of laneKeysOf(task, lane, linksByTask)) {
        map.get(cellId(laneKey, task.statusId))?.push(cardId(laneKey, task.id));
      }
    }
    return map;
  }, [lane, lanes, linksByTask, statuses, visible]);
  const shownIds = live ?? baseIds;

  const columnCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of visible) counts.set(task.statusId, (counts.get(task.statusId) ?? 0) + 1);
    return counts;
  }, [visible]);
  /**
   * Collapsed columns: the ones you collapsed, plus empty Cancelled columns (a thin rail with a
   * count) unless you expanded them. This keeps every working column on screen at 1440px.
   */
  const collapsedColumns = useMemo(() => {
    const auto = (id: string) => statusById.get(id)?.category === 'cancelled' && !(columnCounts.get(id) ?? 0);
    const has = (id: string) => storedCollapsed.has(id) || (auto(id) && !expandedColumns.has(id));
    return {
      has,
      toggle: (id: string) => {
        if (auto(id) && !storedCollapsed.has(id)) expandedColumns.toggle(id);
        else storedCollapsed.toggle(id);
      },
    };
  }, [columnCounts, expandedColumns, statusById, storedCollapsed]);
  /** Work-in-progress limits always count every top-level task in the status (filters don't hide work). */
  const wipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of all) if (!task.parentTaskId) counts.set(task.statusId, (counts.get(task.statusId) ?? 0) + 1);
    return counts;
  }, [all]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );

  const columnName = useCallback((container: string | undefined) => {
    if (!container) return 'a column';
    const { lane: laneKey, statusId } = parseCell(container);
    const status = statusById.get(statusId)?.name ?? 'a column';
    return lane === 'none' ? status : `${status}, ${laneMeta.info(laneKey).title}`;
  }, [lane, laneMeta, statusById]);
  const titleOf = useCallback((id: string) => taskById.get(taskIdOf(id))?.title ?? 'task', [taskById]);

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
      const source = (next.get(from) ?? []).filter((id) => id !== activeId);
      const target = (next.get(to) ?? []).filter((id) => taskIdOf(id) !== taskIdOf(activeId));
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, activeId);
      next.set(from, source);
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
    if (!overId.startsWith(`cell${SEP}`) && ids.includes(overId)) ids = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId));
    const index = ids.indexOf(activeId);
    const originalIndex = (baseIds.get(from) ?? []).indexOf(activeId);
    const moved = from !== to;
    if (!moved && index === originalIndex) return reset();
    if (!moved && !manual) {
      toast.info(`Cards are ordered by ${ORDER_LABELS[order].toLowerCase()}`, 'Switch “Order cards by” to Manual in Display to arrange them yourself.');
      return reset();
    }
    const target = parseCell(to);
    const source = parseCell(from);
    const laneMove = lane !== 'none' && source.lane !== target.lane ? laneMeta.move(task, source.lane, target.lane) : null;
    const siblings = ids.filter((id) => id !== activeId).map((id) => taskById.get(taskIdOf(id))).filter((entry): entry is TaskSummary => Boolean(entry));
    const neighbours = manual ? { above: siblings[index - 1] ?? null, below: siblings[index] ?? null } : undefined;
    const status = statusById.get(target.statusId);
    const finishing = status?.category === 'done' && task.statusCategory !== 'done';
    const pending = ops.applyMove(task, { patch: laneMove?.patch ?? {}, statusId: target.statusId, labelIds: laneMove?.labelIds }, neighbours).then((ok) => {
      if (ok && moved && status) setLiveMessage(`Moved ${task.key} to ${columnName(to)}.`);
      return ok;
    });
    if (finishing) {
      // Same Undo as the List and the drawer: the toast shows as the card lands.
      const previous = task.statusId;
      const undoId = toast.undo(`Marked ${task.key} done`, {
        onUndo: async () => {
          if (await pending) await ops.updateTask(task.id, { statusId: previous });
        },
      });
      void pending.then((ok) => (ok ? undefined : toast.forgetUndo(undoId)));
    }
    // Keep the dropped layout until the optimistic cache update renders.
    setDragId(null);
    setLive(null);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(String(active.id))}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(String(active.id))} is over ${columnName(containerOf(live ?? baseIds, String(over.id)))}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(String(active.id))} in ${columnName(containerOf(live ?? baseIds, String(active.id)))}.` : 'Dropped. Nothing changed.'),
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(String(active.id))} went back where it was.`,
  };

  // Arrow keys move focus between cards (when not dragging).
  const visibleColumns = useMemo(() => statuses.filter((status) => !collapsedColumns.has(status.id)), [collapsedColumns, statuses]);
  const navigate = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string): boolean => {
      if (dragId) return false;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
      const container = containerOf(baseIds, id);
      if (!container) return false;
      const { lane: laneKey, statusId } = parseCell(container);
      const ids = baseIds.get(container) ?? [];
      const index = ids.indexOf(id);
      let next: string | undefined;
      if (event.key === 'ArrowDown') next = ids[index + 1];
      else if (event.key === 'ArrowUp') next = ids[index - 1];
      else if (event.key === 'Home') next = ids[0];
      else if (event.key === 'End') next = ids.at(-1);
      else {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const columnIndex = visibleColumns.findIndex((status) => status.id === statusId);
        for (let cursor = columnIndex + step; cursor >= 0 && cursor < visibleColumns.length; cursor += step) {
          const other = baseIds.get(cellId(laneKey, (visibleColumns[cursor] as { id: string }).id)) ?? [];
          if (other.length) {
            next = other[Math.min(index, other.length - 1)];
            break;
          }
        }
      }
      event.preventDefault();
      if (next) document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next)}"]`)?.focus();
      return true;
    },
    [baseIds, dragId, visibleColumns],
  );

  const setWip = async (statusId: string, wipLimit: number | null) => {
    const result = await updateStatusAction({ statusId, patch: { wipLimit } });
    if (!result.ok) {
      toast.error("Couldn't change the limit", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    toast.success(wipLimit === null ? 'Limit removed' : `Limit set to ${wipLimit} tasks`);
  };

  const addTask = (laneKey: string, statusId: string, title: string) =>
    ops.createTask({ projectId: project.id, title, statusId, at: 'bottom', ...laneMeta.createDefaults(laneKey) }, project.key);

  const { attach, edges, scrollBy } = useHorizontalOverflow();
  const openCard = useCallback((task: TaskSummary) => openTask(task.key), [openTask]);
  const draggingTask = dragId ? taskById.get(taskIdOf(dragId)) : undefined;
  const overContainer = dragId && live ? containerOf(live, dragId) : undefined;
  const isFiltered = view.activeFilterCount > 0;
  const swimlanes = lane !== 'none';

  const renderCards = (container: string) =>
    (shownIds.get(container) ?? []).map((id) => {
      const task = taskById.get(taskIdOf(id));
      if (!task) return null;
      return (
        <BoardCard
          key={id}
          id={id}
          task={task}
          container={container}
          labels={labelById}
          links={linksByTask.get(task.id)}
          canEdit={canEdit}
          sortable={manual}
          ops={ops}
          onOpen={openCard}
          onNavigate={navigate}
        />
      );
    });

  const addButton = (laneKey: string, statusId: string, label: string) =>
    canCreate ? (
      composer === cellId(laneKey, statusId) ? (
        <div className="px-1.5 pb-1.5">
          <BoardComposer label={`New task in ${label}`} onAdd={(title) => addTask(laneKey, statusId, title)} onClose={() => setComposer(null)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setComposer(cellId(laneKey, statusId))}
          className={cn(
            'mx-1.5 mb-1.5 flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus',
            swimlanes && 'opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 max-md:opacity-100',
          )}
          data-testid="column-add-inline"
        >
          <Plus aria-hidden className="size-4" />
          Add task
        </button>
      )
    ) : null;

  const header = (status: (typeof statuses)[number], sticky: boolean) => (
    <ColumnHeader
      status={status}
      count={columnCounts.get(status.id) ?? 0}
      wipCount={wipCounts.get(status.id) ?? 0}
      canCreate={canCreate}
      canManage={canManage}
      sticky={sticky}
      onAdd={() => (swimlanes ? openQuickAdd({ projectId: project.id, statusId: status.id }) : setComposer(cellId('all', status.id)))}
      onCollapse={() => collapsedColumns.toggle(status.id)}
      onWipLimit={(limit) => void setWip(status.id, limit)}
    />
  );

  const laneOptions = SWIMLANES.filter((value) => (value === 'crm' || value === 'wms' ? value === lane || hasLinkLane(value, linksByTask) : true)).map((value) => ({
    value,
    label: value === 'none' ? 'No swimlanes' : GROUP_LABELS[value] ?? value,
  }));
  const controls = ({ iconOnly }: { iconOnly: boolean }) => (
    <DisplayMenu
      iconOnly={iconOnly}
      summary={[lane !== 'none' ? `Lanes: ${GROUP_LABELS[lane]}` : null, !manual ? `Order: ${ORDER_LABELS[order].split(' (')[0]}` : null].filter(Boolean).join(' · ') || null}
      choices={[
        { label: 'Swimlanes', value: lane, options: laneOptions, onChange: (value) => view.setSettings({ swimlane: value as Swimlane }), testId: 'swimlane' },
        { label: 'Order cards by', value: order, options: ORDER_FIELDS.map((value) => ({ value, label: ORDER_LABELS[value] })), onChange: (value) => view.setSettings({ sort: orderRules(value as OrderField) }), testId: 'order' },
      ]}
      toggles={[
        { label: 'Done tasks', checked: view.settings.showCompleted, onChange: (checked) => view.setSettings({ showCompleted: checked }), testId: 'toggle-done' },
        { label: 'Subtasks as cards', checked: view.settings.showSubtasks, onChange: (checked) => view.setSettings({ showSubtasks: checked }), testId: 'toggle-subtasks' },
        { label: `Only done in the last ${RECENT_DONE_DAYS} days`, checked: recentDoneOnly, onChange: () => boardPrefs.toggle('recent-done'), testId: 'toggle-recent-done' },
      ]}
    />
  );

  const toolbar = <ViewToolbar view={view} tasks={all} shownCount={visible.length} totalCount={all.filter((task) => view.settings.showSubtasks || !task.parentTaskId).length} controls={controls} controlsWidth={lane !== 'none' || !manual ? 210 : 100} />;

  if (tasksQuery.isLoading) {
    return (
      <div className="flex h-full min-h-[420px] flex-col" data-testid="board-view">
        {toolbar}
        <BoardSkeleton />
      </div>
    );
  }

  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <div className="flex h-full min-h-[420px] flex-col" data-testid="board-view">
        {toolbar}
        <EmptyState illustration="error" title="We couldn't load the board" description="Check your connection, then try again." actions={<Button onClick={() => void tasksQuery.refetch()}>Try again</Button>} />
      </div>
    );
  }

  const banner =
    all.length === 0 ? (
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-border-subtle bg-panel px-4 py-3 text-sm sm:mx-6" data-testid="board-empty">
        <KanbanSquare aria-hidden className="size-5 shrink-0 text-icon" />
        <span className="min-w-0 flex-1 text-fg-secondary">
          <span className="font-semibold text-fg">No tasks yet.</span> Add one in any column, or press <kbd className="font-sans font-semibold">C</kbd> anywhere.
        </span>
        {canCreate ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setComposer(cellId('all', statuses[0]?.id ?? ''))}>
            Add a task
          </Button>
        ) : null}
      </div>
    ) : visible.length === 0 && isFiltered ? (
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-border-subtle bg-panel px-4 py-3 text-sm sm:mx-6" data-testid="board-filtered-empty">
        <span className="min-w-0 flex-1 text-fg-secondary">
          <span className="font-semibold text-fg">No tasks match these filters.</span> Try removing one.
        </span>
        <Button size="sm" variant="secondary" onClick={view.clearFilters}>
          Clear filters
        </Button>
      </div>
    ) : null;

  const effectiveLanes = swimlanes ? lanes : ['all'];

  return (
    <div className="flex h-full min-h-[420px] flex-col" data-testid="board-view">
      {toolbar}
      {banner}
      <LinkFilterBar filter={linkFilter} shown={visible.length} />
      <ViewCursor rootRef={boardRef} mode="board" tasks={all} ops={ops} canEdit={canEdit} onOpen={openCard} />
      <span role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </span>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={reset}
        accessibility={{ announcements, screenReaderInstructions: { draggable: 'Press Space to pick up the card. Arrow keys move it, Space drops it, Escape cancels. Enter opens it.' } }}
      >
        <div ref={boardRef} className="relative flex min-h-0 flex-1">
          <div
            ref={attach}
            className={cn(
              'flex min-h-0 flex-1 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]',
              swimlanes ? 'flex-col overflow-auto' : 'gap-3 overflow-x-auto overflow-y-hidden px-4 py-3 max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-4 sm:px-6',
            )}
            data-testid="board-canvas"
          >
            {!swimlanes
              ? statuses.map((status) => {
                  const container = cellId('all', status.id);
                  if (collapsedColumns.has(status.id)) {
                    return <CollapsedColumn key={status.id} status={status} count={columnCounts.get(status.id) ?? 0} containerId={container} isOver={overContainer === container} onExpand={() => collapsedColumns.toggle(status.id)} />;
                  }
                  return (
                    <section key={status.id} aria-label={`${status.name}, ${columnCounts.get(status.id) ?? 0} tasks`} data-testid="board-column" data-status-id={status.id} className={cn('flex h-full shrink-0 snap-start flex-col rounded-xl bg-sunken', COLUMN_WIDTH)}>
                      {header(status, false)}
                      <BoardCell containerId={container} cardIds={shownIds.get(container) ?? []} isOver={overContainer === container && dragId !== null} dragging={dragId !== null} fill footer={addButton('all', status.id, status.name)}>
                        {renderCards(container)}
                      </BoardCell>
                    </section>
                  );
                })
              : (
                  <div className="flex min-w-max flex-col pb-6">
                    <div className="sticky top-0 z-[var(--z-sticky)] flex gap-3 bg-app px-4 pt-3 pb-2 sm:px-6">
                      {statuses.map((status) =>
                        collapsedColumns.has(status.id) ? (
                          <div key={status.id} className={cn('shrink-0', COLLAPSED_WIDTH)}>
                            <button type="button" onClick={() => collapsedColumns.toggle(status.id)} aria-label={`Expand ${status.name}`} title={`Expand ${status.name}`} className="flex h-10 w-full items-center justify-center rounded-xl bg-sunken text-xs font-semibold text-fg-secondary tabular-nums outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                              {columnCounts.get(status.id) ?? 0}
                            </button>
                          </div>
                        ) : (
                          <div key={status.id} data-testid="board-column" data-status-id={status.id} className={cn('shrink-0 rounded-xl bg-sunken', COLUMN_WIDTH)}>
                            {header(status, false)}
                          </div>
                        ),
                      )}
                    </div>
                    {effectiveLanes.map((laneKey) => {
                      const info = laneMeta.info(laneKey);
                      const laneCount = new Set(statuses.flatMap((status) => (shownIds.get(cellId(laneKey, status.id)) ?? []).map(taskIdOf))).size;
                      const closed = collapsedLanes.has(laneKey);
                      return (
                        <section key={laneKey} aria-label={`${info.title} swimlane, ${laneCount} tasks`} className="flex flex-col" data-testid="board-lane">
                          <div className="sticky left-0 flex w-fit max-w-[calc(100vw-32px)] items-center gap-2 px-4 pt-3 pb-1.5 sm:px-6">
                            <button
                              type="button"
                              onClick={() => collapsedLanes.toggle(laneKey)}
                              aria-expanded={!closed}
                              className="flex h-7 items-center gap-2 rounded-md px-1.5 text-sm font-semibold text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                            >
                              {closed ? <ChevronRight aria-hidden className="size-4 text-icon" /> : <ChevronDown aria-hidden className="size-4 text-icon" />}
                              {info.icon}
                              <span className="truncate">{lane === 'priority' ? PRIORITY_LABELS[laneKey as keyof typeof PRIORITY_LABELS] ?? info.title : info.title}</span>
                              <span className="font-normal text-fg-muted tabular-nums">{laneCount}</span>
                            </button>
                            {(lane === 'crm' || lane === 'wms') && laneKey !== NO_GROUP ? (
                              <button
                                type="button"
                                onClick={() => linkFilter.set(lane, linkFilter.key === laneKey.toLowerCase() ? null : laneKey)}
                                className="h-7 rounded-md px-2 text-xs font-medium text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                                data-testid="lane-only"
                              >
                                {linkFilter.key === laneKey.toLowerCase() ? 'Show all' : 'Show only this'}
                              </button>
                            ) : null}
                          </div>
                          {closed ? null : (
                            <div className="flex gap-3 px-4 sm:px-6">
                              {statuses.map((status) => {
                                const container = cellId(laneKey, status.id);
                                const ids = shownIds.get(container) ?? [];
                                if (collapsedColumns.has(status.id)) {
                                  return <CollapsedLaneCell key={status.id} containerId={container} count={ids.length} isOver={overContainer === container} />;
                                }
                                return (
                                  <div key={status.id} className={cn('group/cell shrink-0 rounded-xl bg-sunken/70', COLUMN_WIDTH)}>
                                    <BoardCell containerId={container} cardIds={ids} isOver={overContainer === container && dragId !== null} dragging={dragId !== null} fill={false} footer={addButton(laneKey, status.id, `${status.name}, ${info.title}`)}>
                                      {renderCards(container)}
                                    </BoardCell>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </section>
                      );
                    })}
                    {effectiveLanes.length === 0 ? <p className="px-6 py-10 text-center text-sm text-fg-muted">No tasks to show in swimlanes.</p> : null}
                  </div>
                )}
          </div>
          {edges.left ? (
            <button type="button" aria-label="Scroll left" onClick={() => scrollBy(-1)} className="absolute top-1/2 left-2 z-[var(--z-sticky)] hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-raised text-icon shadow-md hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus md:flex">
              <ChevronLeft aria-hidden className="size-4" />
            </button>
          ) : null}
          {edges.right ? (
            <button type="button" aria-label="Scroll right" onClick={() => scrollBy(1)} className="absolute top-1/2 right-2 z-[var(--z-sticky)] hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-raised text-icon shadow-md hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus md:flex">
              <ChevronRight aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {draggingTask ? <BoardCardOverlay task={draggingTask} labels={labelById} links={linksByTask.get(draggingTask.id)} ops={ops} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function CollapsedLaneCell({ containerId, count, isOver }: { readonly containerId: string; readonly count: number; readonly isOver: boolean }) {
  const { setNodeRef } = useDroppableCell(containerId);
  return (
    <div ref={setNodeRef} className={cn('flex min-h-14 shrink-0 items-start justify-center rounded-xl bg-sunken/70 pt-3 text-xs text-fg-muted tabular-nums', COLLAPSED_WIDTH, isOver && 'bg-primary-selected')}>
      {count || ''}
    </div>
  );
}

function useDroppableCell(id: string) {
  return useDroppable({ id, data: { type: 'cell' } });
}
