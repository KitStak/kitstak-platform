'use client';

/**
 * The virtualized board grid. Owns the per-table store, derives the row model from the board
 * payload + view state, and wires virtualization, the sticky group overlay, scroll shadows,
 * drag & drop, the keyboard grid and the dialogs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { FilterX } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { CellServicesProvider, useBoardCellServices, type CellBoard } from '@/features/cells';
import type { BoardPayloadDto, ColumnDto, GroupDto, ItemDto, ViewDto } from '@/server/services/contracts/dto';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { autoFitWidth, computeLayout, type TableLayout } from './lib/columns';
import { toCsv } from './lib/cell-text';
import { itemsByGroup as bucketItems } from './lib/filter-sort';
import { LAYOUT, buildRowModel, rowOffsets, stickyGroupAt } from './lib/rows';
import { countLabel } from './lib/terminology';
import { useSubitemMap } from './hooks/use-board-data';
import { useGridKeyboard } from './hooks/use-grid-keyboard';
import { useLinkedItems } from './hooks/use-linked-items';
import { useRemoteFlash } from './hooks/use-remote-flash';
import { useTableActions } from './hooks/use-table-actions';
import { useTableDnd } from './hooks/use-table-dnd';
import {
  TableStoreContext,
  createTableStore,
  loadCollapsed,
  saveCollapsed,
  useTableStore,
  useTableStoreApi,
} from './state/table-store';
import { useBoardTableState } from './state/use-board-table-state';
import { TableContext, groupColorVar, type OpenItemOptions, type TableContextValue } from './table-context';
import { RowRenderer } from './components/row-renderer';
import { BulkBar } from './components/bulk-bar';
import { ColumnCenter } from './components/column-center';
import { ColumnDialogs } from './components/column-dialogs';
import { ColumnHeaderRow } from './components/column-header-row';
import { DeleteGroupDialog, MoveToBoardDialog, type MoveTarget } from './components/board-dialogs';
import { GroupHeaderRow } from './components/group-rows';
import { EmptyBoard } from './components/table-states';

const OVERSCAN = 10;
const NARROW = 720;
/** Share of a narrow viewport the sticky block (gutter + stripe + checkbox + name) may take. */
const NARROW_STICKY_SHARE = 0.74;
const OVERLAY_HEIGHT = LAYOUT.groupHeader + LAYOUT.columnHeader;
const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export interface TableViewProps {
  readonly boardId: string;
  readonly payload: BoardPayloadDto;
  readonly items: readonly ItemDto[];
  readonly view?: ViewDto | null;
  readonly onOpenItem: (itemId: string, options?: OpenItemOptions) => void;
  readonly loadingMore: boolean;
  readonly readOnly?: boolean;
}

export function TableView(props: TableViewProps) {
  const { boardId, payload } = props;
  const [store] = useState(() => {
    const saved = loadCollapsed(boardId);
    return createTableStore(
      saved ?? payload.groups.filter((group) => group.collapsedDefault).map((group) => group.id),
    );
  });
  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.collapsedGroups !== prev.collapsedGroups) saveCollapsed(boardId, state.collapsedGroups);
      }),
    [boardId, store],
  );
  return (
    <TableStoreContext.Provider value={store}>
      <TableViewInner {...props} />
    </TableStoreContext.Provider>
  );
}

let measureCanvas: HTMLCanvasElement | null = null;
function measureText(text: string): number {
  if (typeof document === 'undefined') return text.length * 7.4;
  measureCanvas ??= document.createElement('canvas');
  const context = measureCanvas.getContext('2d');
  if (!context) return text.length * 7.4;
  context.font = `400 14px ${getComputedStyle(document.body).fontFamily}`;
  return context.measureText(text).width;
}

function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName.replace(/[^\w\- ]+/g, '').trim() || 'export'}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function withStickyWidth(sub: TableLayout, main: TableLayout): TableLayout {
  const columnsWidth = sub.columns.reduce((total, entry) => total + entry.width, 0);
  return {
    ...sub,
    nameWidth: main.nameWidth,
    stickyWidth: main.stickyWidth,
    totalWidth: main.stickyWidth + columnsWidth + LAYOUT.addColumn,
  };
}

function TableViewInner({
  boardId,
  payload,
  items,
  view,
  onOpenItem,
  loadingMore,
  readOnly,
}: TableViewProps) {
  const storeApi = useTableStoreApi();
  const viewState = useBoardTableState(boardId, view);
  const { state } = viewState;
  const board = payload.board;
  const terminology = board.itemTerminology || 'Item';
  const canEdit = board.canEdit && !readOnly;
  const actions = useTableActions(boardId, terminology);
  const baseServices = useBoardCellServices(boardId, items);
  const linked = useLinkedItems(items);
  const services = useMemo(() => {
    // Merge the cells module's names (incl. picker-learned ones) with the by-id resolver.
    const merged = new Map(linked.linkedItems);
    for (const [id, entry] of baseServices.linkedItems ?? []) merged.set(id, entry);
    return { ...baseServices, linkedItems: merged, linkedItemsLoading: linked.loading };
  }, [baseServices, linked.linkedItems, linked.loading]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const liveWidths = useTableStore((s) => s.liveWidths);
  const collapsedGroups = useTableStore((s) => s.collapsedGroups);
  const expanded = useTableStore((s) => s.expanded);
  const dragKind = useTableStore((s) => s.dragKind);
  const dragColumnKey = useTableStore((s) => s.dragColumnKey);
  const selectedCount = useTableStore((s) => s.selected.size);
  const focus = useTableStore((s) => s.focus);

  const groups = useMemo(
    () => [...payload.groups].filter((group) => !group.archivedAt).sort(byPosition),
    [payload.groups],
  );
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const columns = payload.columns;
  const users = payload.users;
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      setViewportWidth(Math.round(entry?.contentRect.width ?? 0)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const maxNameWidth =
    viewportWidth && viewportWidth < NARROW
      ? Math.round(viewportWidth * NARROW_STICKY_SHARE) - LAYOUT.gutter - LAYOUT.stripe - LAYOUT.check
      : undefined;
  const layout = useMemo(
    () => computeLayout(columns, state, { live: liveWidths, maxNameWidth }),
    [columns, liveWidths, maxNameWidth, state],
  );
  const subLayout = useMemo(
    () => withStickyWidth(computeLayout(columns, state, { scope: 'subitem', live: liveWidths }), layout),
    [columns, layout, liveWidths, state],
  );
  const scopedColumns = useMemo(() => columns.filter((column) => column.scope === 'item'), [columns]);

  const buckets = useMemo(
    () =>
      bucketItems(
        items,
        groups.map((group) => group.id),
        state,
        { columns: scopedColumns, users: usersById },
      ),
    [groups, items, scopedColumns, state, usersById],
  );
  const visibleIdsByGroup = useMemo(
    () => new Map([...buckets].map(([groupId, list]) => [groupId, list.map((item) => item.id)])),
    [buckets],
  );
  const subitems = useSubitemMap(expanded);
  const filtering = viewState.hasFilters;

  const model = useMemo(
    () =>
      buildRowModel({
        groups,
        itemsByGroup: buckets,
        collapsedGroupIds: collapsedGroups,
        expandedItemIds: expanded,
        subitems,
        density: state.density,
        collapseAll: dragKind === 'group',
        hideEmptyGroups: filtering,
        canEdit,
        bottomPadding: selectedCount > 0 ? LAYOUT.bulkPadding : 0,
      }),
    [
      buckets,
      canEdit,
      collapsedGroups,
      dragKind,
      expanded,
      filtering,
      groups,
      selectedCount,
      state.density,
      subitems,
    ],
  );
  const offsets = useMemo(() => rowOffsets(model.rows), [model.rows]);

  // Keep the focused row, the row holding DOM focus and the dragged row mounted.
  const pinned = useRef(new Set<string>());
  const rangeExtractor = useCallback(
    (range: Range) => {
      const base = defaultRangeExtractor(range);
      const extra: number[] = [];
      for (const key of pinned.current) {
        const index = model.indexByKey.get(key);
        if (index !== undefined && !base.includes(index)) extra.push(index);
      }
      return extra.length ? [...base, ...extra].sort((a, b) => a - b) : base;
    },
    [model.indexByKey],
  );
  // TanStack Virtual is intentionally not compiler-memoized; rows are memoized by hand.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: useCallback((index: number) => model.rows[index]?.height ?? 36, [model.rows]),
    getItemKey: useCallback((index: number) => model.rows[index]?.key ?? index, [model.rows]),
    overscan: OVERSCAN,
    rangeExtractor,
  });
  // Row heights only change with density / bulk padding (counts are handled by the virtualizer).
  const hasSelection = selectedCount > 0;
  useEffect(() => {
    virtualizer.measure();
  }, [state.density, hasSelection, virtualizer]);
  useEffect(() => {
    if (focus) pinned.current.add(focus.rowKey);
  }, [focus]);

  const scrollToIndex = useCallback(
    (index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }),
    [virtualizer],
  );
  const keyboard = useGridKeyboard({
    model,
    layout,
    subLayout,
    store: storeApi,
    scrollerRef,
    scrollToIndex,
    visibleIdsByGroup,
    actions,
    users: usersById,
    onOpenItem,
  });

  const dnd = useTableDnd({
    store: storeApi,
    actions,
    items,
    groups,
    visibleIdsByGroup,
    sorted: state.sort.length > 0,
  });

  useRemoteFlash(items, storeApi, actions.isLocalChange, !loadingMore);

  // Selection: drop ids that disappeared; clear on view change.
  useEffect(() => {
    const { selected, setSelection } = storeApi.getState();
    if (!selected.size) return;
    const ids = new Set(items.map((item) => item.id));
    const kept = [...selected].filter((id) => ids.has(id));
    if (kept.length !== selected.size) setSelection(kept);
  }, [items, storeApi]);
  useEffect(() => storeApi.getState().clearSelection(), [storeApi, view?.id]);

  // Column Center + dialogs.
  const [center, setCenter] = useState<{
    afterId?: string;
    scope: 'item' | 'subitem';
    returnFocus?: HTMLElement | null;
  } | null>(null);
  const centerReturn = useRef<{ el: HTMLElement | null; afterId?: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<GroupDto | null>(null);

  const addColumn = useCallback(
    async (type: ColumnType, options: { afterId?: string; scope?: 'item' | 'subitem' } = {}) => {
      const created = await actions.createColumn(type, options);
      if (!created) return;
      storeApi.getState().setRenameColumn(created.id);
      requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        if (scroller && !options.afterId)
          scroller.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' });
      });
    },
    [actions, storeApi],
  );

  const exportItems = useCallback(
    (itemIds: readonly string[], label: string) => {
      const ids = new Set(itemIds);
      const chosen = items.filter((item) => ids.has(item.id));
      const exportColumns = [layout.name, ...layout.columns.map((entry) => entry.column)].filter(
        (column): column is ColumnDto => Boolean(column),
      );
      downloadCsv(`${board.name} - ${label}`, toCsv(exportColumns, chosen, usersById));
      toast.success(
        `Exported ${countLabel(chosen.length, terminology.toLowerCase())}`,
        'The CSV opens in Excel, Numbers and Google Sheets.',
      );
    },
    [board.name, items, layout, terminology, usersById],
  );

  const autoFit = useCallback(
    (column: ColumnDto) =>
      viewState.setColumnWidth(column.key, autoFitWidth(column, items, usersById, measureText)),
    [items, usersById, viewState],
  );
  const autoFitAll = useCallback(() => {
    const widths: Record<string, number> = {};
    for (const column of [layout.name, ...layout.columns.map((entry) => entry.column)]) {
      if (column) widths[column.key] = autoFitWidth(column, items, usersById, measureText);
    }
    viewState.setColumnWidths(widths);
  }, [items, layout, usersById, viewState]);

  const scrollTop = virtualizer.scrollOffset ?? 0;
  const sticky = dragKind === 'group' ? null : stickyGroupAt(model, offsets, scrollTop, OVERLAY_HEIGHT);
  const stickyGroup = sticky ? groupsById.get(sticky.groupId) : undefined;
  const virtualItems = virtualizer.getVirtualItems();
  const firstHeader = virtualItems
    .map((virtual) => model.rows[virtual.index])
    .find((row) => row?.kind === 'column-header');
  const renameHost = sticky
    ? 'overlay'
    : firstHeader && 'groupId' in firstHeader
      ? firstHeader.groupId
      : (groups[0]?.id ?? null);
  useEffect(() => {
    if (storeApi.getState().renameHost !== renameHost) storeApi.getState().setRenameHost(renameHost);
  }, [renameHost, storeApi]);
  const revealGroup = useCallback(
    (groupId: string) => {
      const index = model.indexByKey.get(`group:${groupId}`) ?? model.indexByKey.get(`collapsed:${groupId}`);
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'start' });
    },
    [model.indexByKey, virtualizer],
  );

  const cellBoard = useMemo<CellBoard>(
    () => ({ id: board.id, itemTerminology: terminology, columns, groups, canEdit }),
    [board.id, canEdit, columns, groups, terminology],
  );

  const context = useMemo<TableContextValue>(
    () => ({
      boardId,
      board,
      cellBoard,
      columns,
      groups,
      groupsById,
      layout,
      subLayout,
      users,
      usersById,
      terminology,
      canEdit,
      density: state.density,
      view: viewState,
      actions,
      allItems: items,
      visibleIdsByGroup,
      onOpenItem,
      navigate: keyboard.navigate,
      focusCell: keyboard.focusCell,
      openColumnCenter: (options) =>
        {
          centerReturn.current = { el: options?.returnFocus ?? null, afterId: options?.afterId };
          setCenter({ afterId: options?.afterId, scope: options?.scope ?? 'item' });
        },
      addColumn: (type, options) => void addColumn(type, options),
      autoFit,
      autoFitAll,
      exportItems,
      openMoveToBoard: setMoveTarget,
      confirmDeleteGroup: setDeleteGroup,
      revealGroup,
    }),
    [
      revealGroup,
      actions,
      addColumn,
      autoFit,
      autoFitAll,
      board,
      boardId,
      canEdit,
      cellBoard,
      columns,
      exportItems,
      groups,
      groupsById,
      items,
      keyboard.focusCell,
      keyboard.navigate,
      layout,
      onOpenItem,
      state.density,
      subLayout,
      terminology,
      users,
      usersById,
      viewState,
      visibleIdsByGroup,
    ],
  );

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const root = rootRef.current;
    if (!root) return;
    root.dataset.scrolledX = node.scrollLeft > 0 ? 'true' : 'false';
    root.dataset.moreRight = node.scrollLeft + node.clientWidth < node.scrollWidth - 1 ? 'true' : 'false';
  };
  useEffect(() => {
    const node = scrollerRef.current;
    const root = rootRef.current;
    if (node && root)
      root.dataset.moreRight = node.scrollLeft + node.clientWidth < node.scrollWidth - 1 ? 'true' : 'false';
  }, [layout.totalWidth]);

  const totalItems = items.length;
  const width = Math.max(layout.totalWidth, subLayout.totalWidth);

  return (
    <TableContext.Provider value={context}>
      <CellServicesProvider value={services}>
        <div
          ref={rootRef}
          className="bt-root"
          data-testid="board-table-root"
          data-density={state.density}
          data-col-drag={dragColumnKey ?? undefined}
        >
          {dragColumnKey ? (
            <style>{`[data-column-cell="${CSS.escape(dragColumnKey)}"]{opacity:.45}`}</style>
          ) : null}
          {totalItems === 0 && !loadingMore && !filtering ? (
            <EmptyBoard
              noun={terminology}
              canEdit={canEdit}
              onAdd={async () => {
                const groupId = groups[0]?.id ?? (await actions.createGroup(undefined, 'New group'))?.id;
                if (groupId) actions.createItem(groupId, `New ${terminology.toLowerCase()}`);
              }}
            />
          ) : null}
          {filtering && model.ranges.length === 0 ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 px-6 py-12 text-center"
              data-testid="filtered-empty"
            >
              <FilterX aria-hidden className="size-10 text-icon" />
              <div>
                <p className="font-heading text-lg font-semibold text-fg">
                  No {terminology.toLowerCase()}s match this view
                </p>
                <p className="text-base text-fg-secondary">
                  Try a different search, or clear the filters to see every {terminology.toLowerCase()}.
                </p>
              </div>
              <Button variant="secondary" onClick={viewState.clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : null}
          <DndContext
            sensors={dnd.sensors}
            collisionDetection={pointerWithin}
            onDragStart={dnd.onDragStart}
            onDragMove={dnd.onDragMove}
            onDragEnd={dnd.onDragEnd}
            onDragCancel={dnd.onDragCancel}
          >
            <div
              ref={scrollerRef}
              role="grid"
              aria-label={`${board.name} table`}
              aria-rowcount={model.rows.length}
              aria-colcount={layout.columns.length + 2}
              aria-multiselectable="true"
              data-testid="board-table"
              tabIndex={0}
              className="bt-scroller focus-visible:shadow-[inset_0_0_0_2px_var(--focus-ring)]"
              onScroll={onScroll}
              onKeyDown={keyboard.onKeyDown}
              onKeyDownCapture={keyboard.onKeyDownCapture}
              onPaste={keyboard.onPaste}
              onFocus={(event) => {
                const here = keyboard.locate(event.target as HTMLElement);
                if (here) {
                  pinned.current = new Set([here.rowKey]);
                  const current = storeApi.getState().focus;
                  if (current?.rowKey !== here.rowKey || current.col !== here.col)
                    storeApi.getState().setFocus({ rowKey: here.rowKey, col: here.col });
                  return;
                }
                const rowKey = (event.target as HTMLElement).closest<HTMLElement>('[data-row-key]')?.dataset
                  .rowKey;
                if (rowKey) pinned.current = new Set([rowKey]);
                const skip = event.currentTarget.dataset.skipAutofocus === 'true';
                delete event.currentTarget.dataset.skipAutofocus;
                if (
                  !skip &&
                  event.target === event.currentTarget &&
                  event.currentTarget.matches(':focus-visible')
                ) {
                  const first =
                    focus ??
                    (model.rows.find((row) => row.kind === 'item')
                      ? { rowKey: model.rows.find((row) => row.kind === 'item')?.key ?? '', col: 1 }
                      : null);
                  if (first) keyboard.focusCell(first.rowKey, first.col);
                }
              }}
            >
              <div style={{ height: virtualizer.getTotalSize(), width, position: 'relative' }}>
                {sticky && stickyGroup ? (
                  <div className="bt-sticky-overlay" style={{ width }} data-testid="sticky-group-header">
                    <div
                      className="bt-overlay-inner"
                      style={{ transform: `translateY(${sticky.push}px)`, width }}
                    >
                      <GroupHeaderRow
                        overlay
                        group={stickyGroup}
                        items={buckets.get(stickyGroup.id) ?? []}
                        index={0}
                        start={0}
                        height={LAYOUT.groupHeader}
                        width={width}
                      />
                      <ColumnHeaderRow
                        sticky
                        groupId={stickyGroup.id}
                        groupColor={stickyGroup.color}
                        scope="item"
                        itemIds={visibleIdsByGroup.get(stickyGroup.id) ?? []}
                        index={0}
                        start={0}
                        height={LAYOUT.columnHeader}
                        width={layout.totalWidth}
                      />
                    </div>
                  </div>
                ) : null}
                {virtualItems.map((virtual) => {
                  const row = model.rows[virtual.index];
                  if (!row) return null;
                  return (
                    <RowRenderer
                      key={row.key}
                      row={row}
                      index={virtual.index}
                      start={virtual.start}
                      width={width}
                      buckets={buckets}
                      subitems={subitems}
                      dragDisabled={!canEdit}
                    />
                  );
                })}
              </div>
            </div>
            {typeof document !== 'undefined'
              ? createPortal(
                  <DragOverlay dropAnimation={null} zIndex={1500}>
                    {dnd.ghost ? (
                      <div className="bt-ghost" data-testid="drag-ghost">
                        <span
                          className="h-full w-1.5 shrink-0"
                          style={{ background: groupColorVar(dnd.ghost.color) }}
                        />
                        <span className="min-w-0 flex-1 truncate">{dnd.ghost.label}</span>
                        {dnd.ghost.count > 1 ? (
                          <span className="rounded-full bg-primary px-2 text-xs font-semibold text-primary-fg tabular-nums">
                            {dnd.ghost.count}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )
              : null}
          </DndContext>
          <span className="bt-fade-right" aria-hidden />
          {loadingMore ? (
            <span
              role="status"
              className="pointer-events-none absolute right-4 bottom-3 z-10 rounded-full border border-border-subtle bg-raised px-3 py-1 text-xs text-fg-secondary shadow-sm"
            >
              Loading more {terminology.toLowerCase()}s… {countLabel(totalItems, terminology.toLowerCase())}{' '}
              so far
            </span>
          ) : null}
          <BulkBar items={items} />
          <ColumnDialogs />
          <ColumnCenter
            open={center !== null}
            onOpenChange={(open) => {
              if (!open) setCenter(null);
            }}
            existingTypes={columns
              .filter((column) => column.scope === (center?.scope ?? 'item'))
              .map((column) => column.type)}
            onAdd={(type) => void addColumn(type, { afterId: center?.afterId, scope: center?.scope })}
            returnFocus={() => resolveCenterReturn(centerReturn.current, scrollerRef.current, columns)}
          />
          <MoveToBoardDialog
            target={moveTarget}
            currentBoardId={boardId}
            terminology={terminology}
            onOpenChange={(open) => {
              if (!open) setMoveTarget(null);
            }}
            onMove={(target, targetBoardId, boardName) => {
              if (target.kind === 'group') actions.moveGroupToBoard(target.group, targetBoardId, boardName);
              else {
                actions.moveToBoard(target.itemIds, targetBoardId, boardName);
                storeApi.getState().clearSelection();
              }
              setMoveTarget(null);
            }}
          />
          <DeleteGroupDialog
            group={deleteGroup}
            itemCount={deleteGroup ? items.filter((item) => item.groupId === deleteGroup.id).length : 0}
            terminology={terminology}
            onOpenChange={(open) => {
              if (!open) setDeleteGroup(null);
            }}
            onConfirm={(group) => {
              actions.removeGroup(group, 'delete', items.filter((item) => item.groupId === group.id).length);
              setDeleteGroup(null);
            }}
          />
        </div>
      </CellServicesProvider>
    </TableContext.Provider>
  );
}

/**
 * Where focus goes when the Column Center closes: the "+" trigger if it is still mounted,
 * else the menu button of the column it was opened from, else the grid itself.
 */
function resolveCenterReturn(
  target: { el: HTMLElement | null; afterId?: string } | null,
  scroller: HTMLElement | null,
  columns: readonly { id: string; key: string }[],
): HTMLElement | null {
  if (target?.el?.isConnected) return target.el;
  const key = target?.afterId ? columns.find((column) => column.id === target.afterId)?.key : undefined;
  const header = key
    ? scroller?.querySelector<HTMLElement>(
        `[data-testid="column-header"][data-column-key="${CSS.escape(key)}"] [data-testid="column-menu"]`,
      )
    : null;
  return header ?? scroller?.querySelector<HTMLElement>('[data-testid="add-column"]') ?? scroller;
}
