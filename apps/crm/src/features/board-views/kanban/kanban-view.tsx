'use client';
/**
 * Kanban view: lanes from any status / dropdown column (or the groups), colored headers with
 * counts, Σ value and weighted Σ, drag cards between lanes (optimistic, Retry on failure),
 * per-view card order, collapse / reorder lanes, WIP limits, add-in-lane and full keyboard
 * drag with aria-live announcements.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Skeleton, Switch, cn } from '@/components/ui';
import { CellServicesProvider, useBoardCellServices, type CellBoard } from '@/features/cells';
import { useCreateItem, useDuplicateItem, useMoveItem, useRemoveItem } from '@/lib/hooks';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { columnOptions, FieldPicker, FilteredEmpty, ResetSettings, SettingsSection, SettingsSelect, ViewCanvas, ViewError, ViewToolbar } from '../components/view-shell';
import { useCellWriter, useViewConfig, useViewModel } from '../hooks';
import { kanbanSettings, type KanbanSettingsInput } from '../lib/config';
import { applyCardMove, buildLanes, groupIntoLanes, laneCellValue, laneTotals, shiftLane, type Lane } from '../lib/kanban';
import { columnCurrency, GROUP_KEY, LABEL_COLUMN_TYPES, NUMERIC_COLUMN_TYPES, pluralNoun } from '../lib/values';
import type { BoardViewProps } from '../types';
import { isPendingItem, KanbanCard, KanbanCardOverlay, type CardTarget, type KanbanCardActions } from './kanban-card';
import { laneKeyboardCoordinates } from './lane-keyboard';
import { KanbanLane } from './kanban-lane';

type LaneIds = Map<string, string[]>;

const CLOSED_LANE_RE = /(won|lost|done|closed|complete|completed|cancel(l)?ed)/i;

/** Done / won / lost lanes: overdue dates there are noise. */
function isClosedLane(lane: Lane): boolean {
  return Boolean(lane.isDone) || CLOSED_LANE_RE.test(lane.title);
}

/** Edge fades + chevrons when the lane strip overflows horizontally. */
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
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [node]);
  const scrollBy = (direction: 1 | -1) => node?.scrollBy({ left: direction * Math.max(288, node.clientWidth * 0.7), behavior: 'smooth' });
  return { attach: setNode, edges, scrollBy };
}

function laneOf(map: LaneIds, id: string): string | undefined {
  if (id.startsWith('lane:')) return id.slice(5);
  for (const [lane, ids] of map) if (ids.includes(id)) return lane;
  return undefined;
}

export function KanbanSkeleton() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading lanes" className="flex flex-1 gap-4 overflow-hidden bg-sunken p-4">
      {[0, 1, 2].map((lane) => (
        <div key={lane} className="flex w-[272px] shrink-0 flex-col gap-2">
          <Skeleton height={40} rounded="lg" />
          {[0, 1, 2].map((card) => (
            <div key={card} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3">
              <Skeleton height={12} width={`${70 - card * 12}%`} rounded="full" />
              <Skeleton height={24} rounded="sm" />
              <Skeleton height={10} width="40%" rounded="full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function KanbanView({ boardId, view, onOpenItem, initialSettingsOpen, className }: BoardViewProps) {
  const model = useViewModel(boardId, view);
  const { columns, groups, users, items, allItems, noun, canEdit } = model;
  const { save } = useViewConfig<KanbanSettingsInput>(boardId, view, 'kanban');
  const settings = useMemo(() => kanbanSettings(view.config, columns), [view.config, columns]);
  const services = useBoardCellServices(boardId, allItems);
  const writeCell = useCellWriter(boardId);
  const createItem = useCreateItem(boardId);
  const moveItem = useMoveItem(boardId);
  const duplicate = useDuplicateItem(boardId);
  const remove = useRemoveItem(boardId);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(initialSettingsOpen));
  const [addLane, setAddLane] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [live, setLive] = useState<LaneIds | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map());

  const groupColumn = columns.find((column) => column.key === settings.groupBy);
  const lanes = useMemo(() => buildLanes(settings.groupBy, columns, groups, settings.laneOrder), [settings.groupBy, columns, groups, settings.laneOrder]);
  const byLane = useMemo(() => {
    const map = groupIntoLanes(items, lanes, settings.groupBy, columns, settings.cardOrder);
    if (pending.size === 0) return map;
    // Keep optimistic cross-lane moves in place until the cell write lands in the cache.
    for (const [itemId, target] of pending) {
      for (const [laneId, list] of map) {
        const index = list.findIndex((item) => item.id === itemId);
        if (index >= 0 && laneId !== target) {
          const [moved] = list.splice(index, 1);
          if (moved) map.get(target)?.push(moved);
        }
      }
    }
    return map;
  }, [items, lanes, settings.groupBy, columns, settings.cardOrder, pending]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const baseIds = useMemo<LaneIds>(() => new Map([...byLane].map(([lane, list]) => [lane, list.map((item) => item.id)])), [byLane]);
  const shownIds = live ?? baseIds;
  const visibleLanes = settings.hideEmptyLanes ? lanes.filter((lane) => (shownIds.get(lane.id)?.length ?? 0) > 0) : lanes;
  const fields = useMemo(
    () => settings.cardFields.map((key) => columns.find((column) => column.key === key)).filter((column): column is ColumnDto => Boolean(column)),
    [settings.cardFields, columns],
  );
  const sumColumn = columns.find((column) => column.key === settings.sumColumnKey);
  const currency = columnCurrency(sumColumn);
  const cellBoard = useMemo<CellBoard>(() => ({ id: boardId, itemTerminology: noun, columns, groups, canEdit }), [boardId, noun, columns, groups, canEdit]);
  const laneTitle = useCallback((laneId: string | undefined) => lanes.find((lane) => lane.id === laneId)?.title ?? 'lane', [lanes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: laneKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const commitLaneMove = useCallback(
    (item: ItemDto, lane: Lane) => {
      if (settings.groupBy === GROUP_KEY) {
        moveItem.mutate({ itemId: item.id, input: { groupId: lane.id } });
        return;
      }
      setPending((current) => new Map(current).set(item.id, lane.id));
      void writeCell(item.id, settings.groupBy, laneCellValue(lane, groupColumn), {
        failure: `Couldn't move ${noun.toLowerCase()}. Try again`,
      }).finally(() =>
        setPending((current) => {
          const next = new Map(current);
          next.delete(item.id);
          return next;
        }),
      );
    },
    [groupColumn, moveItem, noun, settings.groupBy, writeCell],
  );

  const onDragStart = (event: DragStartEvent) => {
    setDragId(String(event.active.id));
    setLive(new Map([...baseIds].map(([lane, ids]) => [lane, [...ids]])));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !live) return;
    const activeId = String(active.id);
    const from = laneOf(live, activeId);
    const to = laneOf(live, String(over.id));
    if (!from || !to || from === to) return;
    setLive((current) => {
      if (!current) return current;
      const next = new Map(current);
      const source = (next.get(from) ?? []).filter((id) => id !== activeId);
      const target = [...(next.get(to) ?? [])];
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, activeId);
      next.set(from, source);
      next.set(to, target);
      return next;
    });
  };

  const reset = () => {
    setDragId(null);
    setLive(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const activeId = String(active.id);
    const item = itemById.get(activeId);
    if (!over || !live || !item) return reset();
    const originalLane = laneOf(baseIds, activeId);
    const lane = laneOf(live, activeId);
    if (!lane || !originalLane) return reset();
    let ids = live.get(lane) ?? [];
    const overId = String(over.id);
    if (!overId.startsWith('lane:') && ids.includes(overId)) {
      ids = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId));
    }
    const index = ids.indexOf(activeId);
    const originalIndex = (baseIds.get(originalLane) ?? []).indexOf(activeId);
    const moved = lane !== originalLane;
    if (moved || index !== originalIndex) {
      save(
        { cardOrder: applyCardMove(settings.cardOrder, { itemId: activeId, fromLane: originalLane, toLane: lane, targetIds: ids.filter((id) => id !== activeId), index }) },
        { immediate: true },
      );
    }
    const target = lanes.find((entry) => entry.id === lane);
    if (moved && target) commitLaneMove(item, target);
    reset();
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${itemById.get(String(active.id))?.name ?? noun}. Use arrow keys to move, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) =>
      over ? `${itemById.get(String(active.id))?.name ?? noun} is over ${laneTitle(laneOf(live ?? baseIds, String(over.id)))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${itemById.get(String(active.id))?.name ?? noun} in ${laneTitle(laneOf(live ?? baseIds, String(active.id)))}.` : 'Dropped. No change.',
    onDragCancel: ({ active }) => `Cancelled. ${itemById.get(String(active.id))?.name ?? noun} returned to its lane.`,
  };

  const navigateImpl = useCallback(
    (event: KeyboardEvent<HTMLElement>, itemId: string): boolean => {
      if (dragId) return false;
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return false;
      const order = visibleLanes.filter((lane) => !settings.collapsedLanes.includes(lane.id)).map((lane) => lane.id);
      const laneId = laneOf(baseIds, itemId);
      if (!laneId) return false;
      const laneIndex = order.indexOf(laneId);
      const ids = baseIds.get(laneId) ?? [];
      const index = ids.indexOf(itemId);
      let targetId: string | undefined;
      if (event.key === 'ArrowDown') targetId = ids[index + 1];
      else if (event.key === 'ArrowUp') targetId = ids[index - 1];
      else if (event.key === 'Home') targetId = ids[0];
      else if (event.key === 'End') targetId = ids.at(-1);
      else {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        for (let cursor = laneIndex + step; cursor >= 0 && cursor < order.length; cursor += step) {
          const other = baseIds.get(order[cursor] as string) ?? [];
          if (other.length) {
            targetId = other[Math.min(index, other.length - 1)];
            break;
          }
        }
      }
      event.preventDefault();
      if (targetId) document.querySelector<HTMLElement>(`[data-card-id="${targetId}"]`)?.focus();
      return true;
    },
    [baseIds, dragId, settings.collapsedLanes, visibleLanes],
  );

  // Latest handlers live in a ref so `actions` / `onNavigate` stay referentially stable and the
  // memoised cards never re-render because a mutation object changed.
  const [liveMessage, setLiveMessage] = useState('');
  const handlers = useRef<(KanbanCardActions & { navigate: typeof navigateImpl }) | null>(null);
  useEffect(() => {
    handlers.current = {
      navigate: navigateImpl,
      onOpen: (itemId) => onOpenItem?.(itemId),
      onDuplicate: (itemId) => duplicate.mutate({ itemId }),
      onArchive: (itemId) => remove.mutate({ itemId, mode: 'archive' }),
      onDelete: (itemId) => {
        if (isPendingItem({ id: itemId })) return;
        remove.mutate({ itemId, mode: 'delete' });
      },
      onCommit: (item, column, value) =>
        void writeCell(item.id, column.key, value, { failure: `Couldn't update ${column.title.toLowerCase()}` }),
      onMoveToLane: (itemId, laneId) => {
        const item = itemById.get(itemId);
        const lane = lanes.find((entry) => entry.id === laneId);
        if (!item || !lane) return;
        commitLaneMove(item, lane);
        setLiveMessage(`Moved ${item.name} to ${lane.title}.`);
      },
      onMoveToGroup: (itemId, groupId) => moveItem.mutate({ itemId, input: { groupId } }),
      onAddSubitem: (itemId) => {
        createItem.mutate({ name: 'New subitem', parentItemId: itemId });
        onOpenItem?.(itemId);
      },
    };
  });
  const actions = useMemo<KanbanCardActions>(
    () => ({
      onOpen: (itemId) => handlers.current?.onOpen(itemId),
      onDuplicate: (itemId) => handlers.current?.onDuplicate(itemId),
      onArchive: (itemId) => handlers.current?.onArchive(itemId),
      onDelete: (itemId) => handlers.current?.onDelete(itemId),
      onCommit: (item, column, value) => handlers.current?.onCommit(item, column, value),
      onMoveToLane: (itemId, laneId) => handlers.current?.onMoveToLane(itemId, laneId),
      onMoveToGroup: (itemId, groupId) => handlers.current?.onMoveToGroup(itemId, groupId),
      onAddSubitem: (itemId) => handlers.current?.onAddSubitem(itemId),
    }),
    [],
  );
  const onNavigate = useCallback((event: KeyboardEvent<HTMLElement>, itemId: string) => handlers.current?.navigate(event, itemId) ?? false, []);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const laneTargets = useMemo<CardTarget[]>(() => lanes.map((lane) => ({ id: lane.id, title: lane.title })), [lanes]);
  const groupTargets = useMemo<CardTarget[]>(() => groups.map((group) => ({ id: group.id, title: group.title })), [groups]);
  const { attach: attachLanes, edges: laneEdges, scrollBy: scrollLanes } = useHorizontalOverflow();

  const addToLane = (lane: Lane, name: string) => {
    if (settings.groupBy === GROUP_KEY) createItem.mutate({ name, groupId: lane.id });
    else {
      const value = laneCellValue(lane, groupColumn);
      createItem.mutate({ name, ...(value ? { values: { [settings.groupBy]: value } as never } : {}) });
    }
  };

  const toggleCollapse = (laneId: string) =>
    save({
      collapsedLanes: settings.collapsedLanes.includes(laneId)
        ? settings.collapsedLanes.filter((id) => id !== laneId)
        : [...settings.collapsedLanes, laneId],
    });

  const settingsPanel = (
    <>
      <SettingsSection title="Lanes">
        <SettingsSelect
          label="Divide by"
          testId="kanban-divide-by"
          value={settings.groupBy}
          onChange={(value) => save({ groupBy: value, laneOrder: [], collapsedLanes: [], cardOrder: {} })}
          options={[...columnOptions(columns, (column) => LABEL_COLUMN_TYPES.has(column.type)), { value: GROUP_KEY, label: 'Groups' }]}
        />
        <Switch size="sm" label="Hide empty lanes" checked={settings.hideEmptyLanes} onCheckedChange={(checked) => save({ hideEmptyLanes: checked })} />
      </SettingsSection>
      <SettingsSection title="Lane totals" hint="The weighted total multiplies each value by its probability (%).">
        <SettingsSelect
          label="Sum of"
          value={settings.sumColumnKey ?? 'none'}
          onChange={(value) => save({ sumColumnKey: value === 'none' ? null : value })}
          options={[{ value: 'none', label: 'No totals' }, ...columnOptions(columns, (column) => NUMERIC_COLUMN_TYPES.has(column.type))]}
        />
        <SettingsSelect
          label="Weighted by"
          value={settings.weightColumnKey ?? 'none'}
          onChange={(value) => save({ weightColumnKey: value === 'none' ? null : value })}
          options={[{ value: 'none', label: 'Not weighted' }, ...columnOptions(columns, (column) => column.type === 'number')]}
        />
      </SettingsSection>
      <SettingsSection title="Card fields">
        <FieldPicker
          columns={columns.filter((column) => column.type !== 'name' && column.key !== settings.groupBy)}
          selected={settings.cardFields}
          onChange={(next) => save({ cardFields: next })}
        />
        <Switch size="sm" label="Show empty fields" checked={settings.showEmptyFields} onCheckedChange={(checked) => save({ showEmptyFields: checked })} />
      </SettingsSection>
      <ResetSettings onReset={() => save({ groupBy: undefined, cardFields: undefined, hideEmptyLanes: false, collapsedLanes: [], laneOrder: [], cardOrder: {}, wipLimits: {}, sumColumnKey: undefined, weightColumnKey: undefined, showEmptyFields: true }, { immediate: true })} />
    </>
  );

  const activeItem = dragId ? itemById.get(dragId) : undefined;
  let body;
  if (model.query.isError && !model.query.data) body = <ViewError onRetry={() => void model.query.refetch()} what="the Kanban" />;
  else if (!model.query.data) body = <KanbanSkeleton />;
  else if (items.length === 0 && allItems.length > 0)
    body = (
      <div className="flex flex-1 items-center justify-center bg-sunken">
        <FilteredEmpty noun={pluralNoun(noun, 2)} onClear={model.clearSearch} />
      </div>
    );
  else
    body = (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={reset}
        accessibility={{ announcements, screenReaderInstructions: { draggable: 'Press Space to pick up the card. Arrow keys move it, Space drops it, Escape cancels. Enter opens it.' } }}
      >
        {allItems.length === 0 ? (
          <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-panel px-4 py-2.5 text-sm" data-testid="kanban-empty">
            <span className="min-w-0 flex-1 text-fg-secondary">
              <span className="font-semibold text-fg">No {pluralNoun(noun, 2)} yet.</span> Add one in any lane and it shows up there.
            </span>
            {canEdit ? (
              <Button size="sm" onClick={() => setAddLane(lanes[0]?.id ?? null)} data-testid="kanban-empty-new">
                New {noun.toLowerCase()}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1">
        <div
          ref={attachLanes}
          className="flex min-h-0 flex-1 gap-4 overflow-x-auto bg-sunken p-4 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] max-[480px]:gap-3 max-[480px]:p-3"
          data-testid="kanban-canvas"
        >
          {visibleLanes.map((lane, index) => {
            const ids = shownIds.get(lane.id) ?? [];
            const laneItems = ids.map((id) => itemById.get(id)).filter((item): item is ItemDto => Boolean(item));
            const overThis = Boolean(dragId) && laneOf(shownIds, dragId as string) === lane.id && laneOf(baseIds, dragId as string) !== lane.id;
            return (
              <KanbanLane
                key={lane.id}
                lane={lane}
                itemIds={ids}
                totals={laneTotals(laneItems, settings.sumColumnKey, settings.weightColumnKey)}
                currency={currency}
                wipLimit={settings.wipLimits[lane.id]}
                collapsed={settings.collapsedLanes.includes(lane.id)}
                isOver={overThis}
                noun={noun}
                canEdit={canEdit}
                isFirst={index === 0}
                isLast={index === visibleLanes.length - 1}
                addOpen={addLane === lane.id}
                onAddOpenChange={(open) => setAddLane(open ? lane.id : null)}
                onAdd={(name) => addToLane(lane, name)}
                onToggleCollapse={() => toggleCollapse(lane.id)}
                onMove={(delta) => save({ laneOrder: shiftLane(lanes.map((entry) => entry.id), lane.id, delta) })}
                onWipLimit={(limit) => {
                  const next = { ...settings.wipLimits };
                  if (limit) next[lane.id] = limit;
                  else delete next[lane.id];
                  save({ wipLimits: next });
                }}
              >
                {laneItems.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    laneId={lane.id}
                    fields={fields}
                    board={cellBoard}
                    users={users}
                    userMap={userMap}
                    closed={isClosedLane(lane)}
                    lanes={laneTargets}
                    groups={groupTargets}
                    noun={noun}
                    showEmptyFields={settings.showEmptyFields}
                    actions={actions}
                    canEdit={canEdit}
                    onNavigate={onNavigate}
                  />
                ))}
              </KanbanLane>
            );
          })}
          {/* Trailing gutter after the last lane: overflow flex ignores padding-right. */}
          <div aria-hidden className="w-1 shrink-0" />
        </div>
        {(['left', 'right'] as const).map((side) =>
          laneEdges[side] ? (
            <div
              key={side}
              className={cn(
                'pointer-events-none absolute inset-y-0 z-[var(--z-raised)] flex w-14 items-center',
                side === 'left' ? 'left-0 justify-start bg-gradient-to-r pl-2' : 'right-0 justify-end bg-gradient-to-l pr-2',
                'from-[var(--surface-sunken)] to-transparent',
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={side === 'left' ? 'Scroll to earlier lanes' : 'Scroll to more lanes'}
                data-testid={`kanban-scroll-${side}`}
                onClick={() => scrollLanes(side === 'left' ? -1 : 1)}
                className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-full border border-border-subtle bg-panel text-icon shadow-md transition-[transform,color] duration-[var(--duration-fast)] ease-out hover:text-icon-strong active:scale-95"
              >
                {side === 'left' ? <ChevronLeft aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
              </button>
            </div>
          ) : null,
        )}
        </div>
        <span className="sr-only" aria-live="polite">{liveMessage}</span>
        <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0, 0, 0.35, 1)' }}>
          {activeItem ? (
            <KanbanCardOverlay
              item={activeItem}
              laneId=""
              fields={fields}
              board={cellBoard}
              users={users}
              userMap={userMap}
              closed={false}
              lanes={laneTargets}
              groups={groupTargets}
              noun={noun}
              showEmptyFields={settings.showEmptyFields}
              actions={actions}
              canEdit={false}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    );

  return (
    <CellServicesProvider value={services}>
      <ViewCanvas testId="kanban-view" busy={!model.query.data} className={className}>
        <ViewToolbar
          search={model.search}
          onSearch={model.setSearch}
          searchLabel={`Search ${pluralNoun(noun, 2)}`}
          settings={settingsPanel}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          settingsTitle="Kanban settings"
        >
          <span className="text-sm text-fg-secondary tabular-nums" data-testid="kanban-summary">
            {items.length} {pluralNoun(noun, items.length)}
            {groupColumn ? <> · by {groupColumn.title.toLowerCase()}</> : settings.groupBy === GROUP_KEY ? <> · by group</> : null}
          </span>
        </ViewToolbar>
        {body}
      </ViewCanvas>
    </CellServicesProvider>
  );
}
