'use client';

/**
 * DataGrid (BUILD_PLAN F4.3) — rewritten; legacy props stay backward-compatible.
 *
 *   - server multi-sort when `sort` + `onSortChange` are passed (client sort otherwise)
 *   - columns: resize, drag-reorder, pin-left, legacy `meta.sticky: "right"`
 *   - per-user prefs (visible/order/widths/pins/density) via `gridKey` → /api/grid-prefs
 *   - tri-state page checkbox; selection survives paging (ids); "Select all N matching"
 *   - density Large/Small, page sizes 100–1000, Total/Selected, `|< < [n] / N > >|`
 *   - windowed rows above 200, header `?` tips, row kebab (`rowActions`), expandable rows
 *   - Export As Excel (async, Transactions tray) when `gridKey` + `queryString` are set;
 *     legacy callers without a gridKey keep the client-side CSV export
 */
import * as React from 'react';
import {
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingInfoState,
  type ColumnSizingState,
  type ExpandedState,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortSpec } from '@/server/query/grid-query';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { ColumnChooser, type ChooserColumn } from './column-chooser';
import { DataGridBody } from './data-grid-body';
import { DataGridHeader, HeaderDndContext } from './data-grid-header';
import {
  actionsColumn,
  columnLabel,
  expandColumn,
  EXPAND_COLUMN_ID,
  gutterColumn,
  isSystemColumn,
  SELECT_COLUMN_ID,
  selectColumn,
  stickyRightOffsetFor,
} from './data-grid-columns';
import { ExportButton, type ExportColumnSpec } from './export-button';
import { GridFooter } from './grid-footer';
import { MobileCardList } from './mobile-card-list';
import { clampWidth, moveColumn, visibilityMap, type PrefColumn } from './grid-prefs';
import { nextSort } from './grid-sort';
import { exportCsv } from './legacy-csv';
import { SelectionBanner } from './selection-banner';
import type { GridColumnMeta, GridDensity, RowAction } from './grid-types';
import { useGridPrefs } from './use-grid-prefs';

/** Legacy density names (pre-F4). `"comfortable"` = Large, `"compact"` = Small. */
export type Density = 'comfortable' | 'compact';
export type { GridColumnMeta };

export interface DataGridProps<T> {
  readonly columns: ColumnDef<T, unknown>[];
  readonly data: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange?: (size: number) => void;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: React.ReactNode;
  readonly getRowId: (row: T) => string;
  readonly selection?: RowSelectionState;
  readonly onSelectionChange?: (next: RowSelectionState) => void;
  readonly onRowClick?: (row: T) => void;
  /** Legacy CSV file name (used when no gridKey is set). */
  readonly exportName?: string;
  readonly onRefresh?: () => void;
  readonly toolbarLeft?: React.ReactNode;
  readonly toolbarRight?: (selectedCount: number) => React.ReactNode;

  /* ---- F4 additions (all optional) ---- */
  /** Persists column prefs per user and enables Export As Excel. */
  readonly gridKey?: string;
  /** Canonical grid query (for export). */
  readonly queryString?: string;
  readonly exportColumns?: readonly ExportColumnSpec[];
  /** Server sort (grid grammar). Passing `onSortChange` switches to manual sorting. */
  readonly sort?: readonly SortSpec[];
  readonly onSortChange?: (sort: readonly SortSpec[]) => void;
  readonly rowActions?: (row: T) => readonly RowAction[];
  readonly renderExpanded?: (row: T) => React.ReactNode;
  readonly canSelectRow?: (row: T) => boolean;
  /** Hide the selection checkboxes entirely. */
  readonly selectable?: boolean;
  /** "Select all N matching" support (bulk ops on the whole query). */
  readonly allMatchingSelected?: boolean;
  readonly onAllMatchingSelectedChange?: (value: boolean) => void;
  readonly density?: GridDensity;
  readonly onDensityChange?: (density: GridDensity) => void;
  /** Hide the built-in toolbar row (when a page renders `GridToolbar` itself). */
  readonly hideToolbar?: boolean;
  readonly className?: string;
  /**
   * True while the rows on screen belong to a previous query (search / filter / page change in
   * flight): the body dims, a thin progress bar runs under the header and the grid is aria-busy.
   */
  readonly refreshing?: boolean;
  /** Scroll this row into view and flash it for 2 s (e.g. the record just created or saved). */
  readonly highlightRowId?: string | null;
  /** Footer export: "auto" (default: Excel when gridKey + queryString, else CSV), "csv", or "none" (the page renders its own). */
  readonly exportMode?: 'auto' | 'csv' | 'none';
  /** Excel export key/query when they differ from the prefs `gridKey` / `queryString` (e.g. a detail page lines grid). */
  readonly exportGridKey?: string;
  readonly exportQuery?: string;
  /** Row navigating away (useRowNav): it shows a pending overlay until the route lands. */
  readonly pendingRowId?: string | null;
  /**
   * Phone fallback: below `md` the table (which only fits ~2 columns) hides and each row
   * renders as a tappable card with this body instead (MobileCardList).
   */
  readonly renderMobileCard?: (row: T) => React.ReactNode;
}

/** Scroll a row into view and flash it once when `rowId` appears in the rendered page. */
function useHighlightRow(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  rowId: string | null,
  rowCount: number,
) {
  const done = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!rowId || done.current === rowId) return;
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`tr[data-row-id="${CSS.escape(rowId)}"]`);
    if (!el) return;
    done.current = rowId;
    el.scrollIntoView({ block: 'nearest' });
    el.setAttribute('data-highlight', '');
    const t = window.setTimeout(() => el.removeAttribute('data-highlight'), 2000);
    return () => window.clearTimeout(t);
  }, [scrollRef, rowId, rowCount]);
}

/** Publishes the scroll box width as `--grid-visible-width` (expanded rows pin their panel to it). */
function useVisibleWidthVar(scrollRef: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => el.style.setProperty('--grid-visible-width', `${el.clientWidth}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);
}

function prefColumnsOf<T>(columns: readonly ColumnDef<T, unknown>[]): readonly PrefColumn[] {
  return columns.map((c, i) => ({
    id: columnIdOf(c, i),
    defaultVisible: c.meta?.defaultVisible !== false,
    alwaysVisible: c.meta?.alwaysVisible === true || c.enableHiding === false,
    defaultPinned: c.meta?.defaultPinned === true,
  }));
}

function columnIdOf<T>(c: ColumnDef<T, unknown>, index: number): string {
  if (c.id) return c.id;
  if ('accessorKey' in c && typeof c.accessorKey === 'string') return c.accessorKey.replaceAll('.', '_');
  return typeof c.header === 'string' ? c.header : `col_${index}`;
}

function hasAccessor<T>(c: ColumnDef<T, unknown>): boolean {
  return (
    ('accessorKey' in c && c.accessorKey !== undefined) ||
    ('accessorFn' in c && typeof c.accessorFn === 'function')
  );
}

/**
 * Every data column is sortable by default: a display column (id only, no accessor) gets an
 * accessor reading `row[meta.sortKey ?? id]`, so the header shows the sort affordance and
 * client-side sorting works. Opt out per column with `enableSorting: false`.
 */
export function withDefaultSort<T>(c: ColumnDef<T, unknown>, id: string): ColumnDef<T, unknown> {
  if (c.enableSorting === false || hasAccessor(c)) return { ...c, id } as ColumnDef<T, unknown>;
  const key = c.meta?.sortKey ?? id;
  return { ...c, id, accessorFn: (row: T) => (row as Record<string, unknown> | null)?.[key] } as ColumnDef<
    T,
    unknown
  >;
}

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    columns,
    data,
    total,
    page,
    pageSize,
    onPageChange,
    onPageSizeChange,
    loading = false,
    error = null,
    onRetry,
    getRowId,
    onRowClick,
    onRefresh,
    toolbarLeft,
    toolbarRight,
    gridKey,
    sort: sortProp,
    onSortChange,
    rowActions,
    renderExpanded,
    selectable = true,
  } = props;

  const idColumns = React.useMemo(
    () => columns.map((c, i) => withDefaultSort(c, columnIdOf(c, i))),
    [columns],
  );
  const prefColumns = React.useMemo(() => prefColumnsOf(idColumns), [idColumns]);
  const prefs = useGridPrefs(gridKey, prefColumns);

  const [localSort, setLocalSort] = React.useState<readonly SortSpec[]>([]);
  const sort = sortProp ?? localSort;
  const manualSorting = Boolean(onSortChange);
  const setSort = (next: readonly SortSpec[]) => (onSortChange ? onSortChange(next) : setLocalSort(next));

  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({});
  const rowSelection = props.selection ?? internalSelection;
  const setRowSelection = props.onSelectionChange ?? setInternalSelection;
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [sizing, setSizing] = React.useState<ColumnSizingState | null>(null);
  const [sizingInfo, setSizingInfo] = React.useState<ColumnSizingInfoState>({
    startOffset: null,
    startSize: null,
    deltaOffset: null,
    deltaPercentage: null,
    isResizingColumn: false,
    columnSizingStart: [],
  });
  const sizingRef = React.useRef<ColumnSizingState>({});

  const density: GridDensity = props.density ?? prefs.prefs.density;
  const setDensity = (d: GridDensity) =>
    props.onDensityChange ? props.onDensityChange(d) : prefs.update({ density: d });

  const allColumns = React.useMemo(() => {
    const list: ColumnDef<T, unknown>[] = [];
    if (selectable) list.push(selectColumn<T>());
    if (renderExpanded) list.push(expandColumn<T>());
    list.push(...idColumns);
    if (rowActions) list.push(actionsColumn<T>(rowActions));
    // External toolbar: the column chooser floats over the header right end, so reserve a gutter for it.
    else if (props.hideToolbar) list.push(gutterColumn<T>());
    return list;
  }, [idColumns, selectable, renderExpanded, rowActions, props.hideToolbar]);

  const sortingState: SortingState = React.useMemo(() => {
    const byField = new Map(idColumns.map((c) => [c.meta?.sortKey ?? c.id ?? '', c.id ?? '']));
    return sort
      .map((s) => ({ id: byField.get(s.field) ?? s.field, desc: s.dir === 'desc' }))
      .filter((s) => idColumns.some((c) => c.id === s.id));
  }, [sort, idColumns]);

  const columnSizing = sizing ?? prefs.prefs.widths;
  const systemLeft = [selectable ? SELECT_COLUMN_ID : null, renderExpanded ? EXPAND_COLUMN_ID : null].filter(
    (x): x is string => x !== null,
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns non-memoisable functions by design
  const table = useReactTable({
    data,
    columns: allColumns,
    state: {
      sorting: sortingState,
      columnVisibility: visibilityMap(prefs.prefs),
      columnOrder: [...systemLeft, ...prefs.prefs.order],
      columnPinning: {
        left: [
          ...new Set([
            ...systemLeft,
            ...allColumns.flatMap((c) => (c.meta?.pinLeft && c.id ? [c.id] : [])),
            ...(prefs.prefs.pinned ?? []),
          ]),
        ],
      },
      columnSizing,
      columnSizingInfo: sizingInfo,
      rowSelection,
      expanded,
    },
    manualSorting,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableMultiSort: true,
    getRowId,
    enableRowSelection: props.canSelectRow ? (row) => props.canSelectRow?.(row.original) ?? true : true,
    getRowCanExpand: () => Boolean(renderExpanded),
    onRowSelectionChange: (updater) =>
      setRowSelection(typeof updater === 'function' ? updater(rowSelection) : updater),
    onExpandedChange: setExpanded,
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;
      sizingRef.current = next;
      setSizing(next);
    },
    onColumnSizingInfoChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sizingInfo) : updater;
      if (sizingInfo.isResizingColumn && !next.isResizingColumn) {
        const widths = Object.fromEntries(
          Object.entries(sizingRef.current)
            .filter(([id]) => !isSystemColumn(id))
            .map(([id, w]) => [id, clampWidth(w)]),
        );
        prefs.update({ widths });
        setSizing(null);
      }
      setSizingInfo(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getExpandedRowModel: renderExpanded ? getExpandedRowModel() : undefined,
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const selectedCount = props.allMatchingSelected ? total : selectedIds.length;
  const pageIds = table.getRowModel().rows.map((r) => r.id);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickyRightOffset = stickyRightOffsetFor(table);
  const chooserColumns: readonly ChooserColumn[] = idColumns.map((c) => ({
    id: c.id ?? '',
    label: columnLabel(c, c.id ?? ''),
    alwaysVisible: c.meta?.alwaysVisible === true || c.enableHiding === false,
  }));

  useHighlightRow(scrollRef, props.highlightRowId ?? null, data.length);
  useVisibleWidthVar(scrollRef);
  const refreshing = Boolean(props.refreshing) && !loading;
  const exportMode = props.exportMode ?? 'auto';
  const excelKey = props.exportGridKey ?? gridKey;
  const excelQuery = props.exportQuery ?? props.queryString;

  const reorder = (id: string, before: string | null) =>
    prefs.update({ order: moveColumn(prefs.prefs.order, id, before) });

  const changePageSize = onPageSizeChange
    ? (size: number) => {
        onPageSizeChange(size);
        prefs.update({ pageSize: size });
      }
    : undefined;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', props.className)}>
      {props.hideToolbar ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">{toolbarLeft}</div>
          <div className="flex items-center gap-2">
            {toolbarRight?.(selectedCount)}
            <ColumnChooser
              columns={chooserColumns}
              prefs={prefs.prefs}
              onApply={(patch) => prefs.update(patch)}
              onReset={prefs.reset}
            />
            {onRefresh ? (
              <Tooltip content="Refresh">
                <Button variant="ghost" size="icon" aria-label="Refresh" onClick={onRefresh}>
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      )}

      <div className="mx-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <SelectionBanner
          pageCount={pageIds.length}
          pageAllSelected={pageIds.length > 0 && pageIds.every((id) => rowSelection[id])}
          total={total}
          selectedCount={selectedCount}
          allMatching={props.allMatchingSelected ?? false}
          onSelectAllMatching={
            props.onAllMatchingSelectedChange ? () => props.onAllMatchingSelectedChange?.(true) : undefined
          }
          onClear={() => {
            setRowSelection({});
            props.onAllMatchingSelectedChange?.(false);
          }}
        />
        <HeaderDndContext table={table} onReorder={reorder}>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {props.hideToolbar ? (
              // External toolbar (useGrid + GridToolbar): pin the chooser to the header row's right end (Logiwa parity).
              <div
                className={cn(
                  'absolute right-1 top-1 z-30 rounded-md bg-surface shadow-[-8px_0_8px_-4px_var(--surface)]',
                  // Card view has no columns to choose.
                  props.renderMobileCard && 'max-md:hidden',
                )}
              >
                <ColumnChooser
                  columns={chooserColumns}
                  prefs={prefs.prefs}
                  onApply={(patch) => prefs.update(patch)}
                  onReset={prefs.reset}
                  size="sm"
                />
              </div>
            ) : null}
            {/* Capped at the viewport so long grids scroll inside the frame and the sticky header stays visible. */}
            {refreshing ? (
              <div
                role="progressbar"
                aria-label="Updating rows"
                className="ks-grid-progress pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-info/15"
              />
            ) : null}
            {props.renderMobileCard ? (
              <div
                aria-busy={refreshing || undefined}
                className="ks-scroll max-h-[calc(100dvh-8rem)] min-h-0 flex-1 overflow-auto md:hidden"
              >
                <MobileCardList
                  data={data}
                  getRowId={props.getRowId}
                  renderCard={props.renderMobileCard}
                  onRowClick={onRowClick}
                  pendingRowId={props.pendingRowId}
                  loading={loading}
                  error={error}
                  onRetry={onRetry}
                  emptyTitle={props.emptyTitle ?? 'Nothing here yet'}
                  emptyDescription={
                    props.emptyDescription ?? 'Adjust your filters or create a new record to get started.'
                  }
                  className={cn('transition-opacity', refreshing && 'opacity-60')}
                />
              </div>
            ) : null}
            <div
              ref={scrollRef}
              aria-busy={refreshing || undefined}
              data-refreshing={refreshing || undefined}
              className={cn(
                'ks-scroll max-h-[calc(100dvh-8rem)] min-h-0 flex-1 overflow-auto',
                props.renderMobileCard && 'max-md:hidden',
              )}
            >
              <table
                aria-rowcount={total + 1}
                aria-colcount={table.getVisibleLeafColumns().length}
                className={cn(
                  'w-full min-w-max border-collapse text-sm transition-opacity',
                  sizingInfo.isResizingColumn && 'select-none',
                  refreshing && '[&>tbody]:opacity-60',
                )}
              >
                <DataGridHeader
                  table={table}
                  sort={sort}
                  onSort={(field, additive) => setSort(nextSort(sort, field, additive))}
                  onReorder={reorder}
                  stickyRightOffset={stickyRightOffset}
                />
                <DataGridBody
                  table={table}
                  density={density}
                  loading={loading}
                  error={error}
                  onRetry={onRetry}
                  emptyTitle={props.emptyTitle ?? 'Nothing here yet'}
                  emptyDescription={
                    props.emptyDescription ?? 'Adjust your filters or create a new record to get started.'
                  }
                  emptyAction={props.emptyAction}
                  onRowClick={onRowClick}
                  renderExpanded={renderExpanded}
                  stickyRightOffset={stickyRightOffset}
                  scrollRef={scrollRef}
                  rowOffset={(Math.max(1, page) - 1) * pageSize}
                  highlightRowId={props.highlightRowId ?? null}
                  pendingRowId={props.pendingRowId ?? null}
                />
              </table>
            </div>
          </div>
        </HeaderDndContext>
        <GridFooter
          loading={(loading || Boolean(error)) && data.length === 0}
          showSelected={selectable}
          total={total}
          page={page}
          pageSize={pageSize}
          selectedCount={selectedCount}
          density={density}
          onDensityChange={setDensity}
          onPageChange={onPageChange}
          onPageSizeChange={changePageSize}
          trailing={
            exportMode === 'none' ? null : exportMode === 'auto' && excelKey && excelQuery !== undefined ? (
              <ExportButton
                gridKey={excelKey}
                queryString={excelQuery}
                columns={props.exportColumns}
                total={total}
                disabledReason={loading && data.length === 0 ? 'Wait for the rows to load' : null}
              />
            ) : (
              <Button
                variant="success-outline"
                size="sm"
                disabled={data.length === 0}
                onClick={() => exportCsv(data, columns, props.exportName ?? 'export')}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export CSV
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}
