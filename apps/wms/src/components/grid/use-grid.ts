"use client";

/**
 * `useGrid` ties a list page together (BUILD_PLAN F4.3): URL state (grid grammar) →
 * list query → saved views → selection. Spread `gridProps` into <DataGrid> and
 * `toolbarProps` into <GridToolbar>. Uses `useSearchParams`: render inside <Suspense>.
 *
 *   const g = useGrid<Order>({ gridKey: "orders", path: "/api/orders", fields });
 *   <GridToolbar {...g.toolbarProps} bulkActions={…} />
 *   <DataGrid {...g.gridProps} columns={columns} getRowId={(o) => o.id} />
 */
import * as React from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { useApiQuery } from "@/lib/query-client";
import { useGridUrlState, type GridUrlState } from "@/lib/use-url-state";
import { parseGridQuery, type GridQuery, type SortSpec } from "@/server/query/grid-query";
import type { FilterFieldDef } from "./grid-types";
import { useLocalGridState } from "./use-local-grid-state";
import { useSavedViews, type SavedView } from "./use-saved-views";

export interface UseGridOptions {
  readonly gridKey: string;
  /** List endpoint, e.g. `/api/orders`. `null` disables fetching. */
  readonly path: string | null;
  readonly fields?: readonly FilterFieldDef[];
  /** Extra non-grid params (e.g. `{ status: "open" }` for a route tab). */
  readonly extraQuery?: Readonly<Record<string, string>>;
  /** Apply the user's default saved view when the URL carries no grid state. Default true. */
  readonly applyDefaultView?: boolean;
  /** List request timeout (default 30 s); slow lists can raise it. */
  readonly timeoutMs?: number;
}

/** Grid query string without paging — the identity of "the same view". */
export function viewIdentity(queryString: string): string {
  const params = new URLSearchParams(queryString);
  params.delete("page");
  params.delete("ps");
  params.sort();
  return params.toString();
}

export function findActiveView(views: readonly SavedView[], queryString: string): SavedView | undefined {
  const id = viewIdentity(queryString);
  return views.find((v) => viewIdentity(v.query) === id);
}

function isEmptyQuery(q: GridQuery): boolean {
  return !q.q && q.filters.length === 0 && q.sort.length === 0;
}

export interface UseGridResult<T> {
  readonly grid: GridUrlState;
  readonly rows: readonly T[];
  readonly total: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
  readonly selectedIds: readonly string[];
  readonly allMatchingSelected: boolean;
  readonly clearSelection: () => void;
  readonly views: ReturnType<typeof useSavedViews>;
  readonly activeView: SavedView | undefined;
  readonly applyView: (view: SavedView) => void;
  readonly gridProps: {
    readonly gridKey: string;
    readonly queryString: string;
    readonly data: T[];
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly onPageChange: (page: number) => void;
    readonly onPageSizeChange: (size: number) => void;
    readonly loading: boolean;
    /** True while the rows shown belong to the previous query (placeholder data): DataGrid dims them. */
    readonly refreshing: boolean;
    readonly error: string | null;
    readonly onRetry: () => void;
    readonly sort: readonly SortSpec[];
    readonly onSortChange: (sort: readonly SortSpec[]) => void;
    readonly selection: RowSelectionState;
    readonly onSelectionChange: (next: RowSelectionState) => void;
    readonly allMatchingSelected: boolean;
    readonly onAllMatchingSelectedChange: (value: boolean) => void;
    readonly hideToolbar: true;
  };
  readonly toolbarProps: {
    readonly grid: GridUrlState;
    readonly fields: readonly FilterFieldDef[];
    readonly views: ReturnType<typeof useSavedViews>;
    readonly activeViewId: string | null;
    readonly onApplyView: (view: SavedView) => void;
    readonly selectedIds: readonly string[];
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
  };
}

interface SelectionState {
  readonly base: string;
  readonly rows: RowSelectionState;
  readonly allMatching: boolean;
}

/** A list request that hangs longer than this shows the grid error state with Retry, not an endless skeleton. */
const GRID_TIMEOUT_MS = 30_000;

/** URL-backed grid (list pages). */
export function useGrid<T>(options: UseGridOptions): UseGridResult<T> {
  return useGridCore<T>(useGridUrlState(options.gridKey), options);
}

/** In-memory grid (pickers inside modals/drawers); default views are not applied. */
export function useLocalGrid<T>(options: UseGridOptions & { readonly initial?: Partial<GridQuery> }): UseGridResult<T> {
  return useGridCore<T>(useLocalGridState(options.gridKey, options.initial), { ...options, applyDefaultView: false });
}

function useGridCore<T>(grid: GridUrlState, { gridKey, path, fields = [], extraQuery, applyDefaultView = true, timeoutMs = GRID_TIMEOUT_MS }: UseGridOptions): UseGridResult<T> {
  const views = useSavedViews(gridKey);
  const extra = React.useMemo(() => new URLSearchParams(extraQuery ?? {}).toString(), [extraQuery]);
  const requestQuery = extra ? `${grid.queryString}${grid.queryString ? "&" : ""}${extra}` : grid.queryString;
  const list = useApiQuery<T[]>(["grid", gridKey, path ?? ""], path, { query: requestQuery, placeholderData: (prev) => prev, timeoutMs });

  // Default view: once, only when the page opened without grid state.
  const defaultApplied = React.useRef(false);
  const initialEmpty = React.useRef(isEmptyQuery(grid.query));
  React.useEffect(() => {
    if (defaultApplied.current || !applyDefaultView || views.isLoading) return;
    defaultApplied.current = true;
    const def = views.views.find((v) => v.isDefault);
    if (def && initialEmpty.current) grid.setQuery(parseGridQuery(def.query).query);
  }, [applyDefaultView, views.isLoading, views.views, grid]);

  const base = viewIdentity(grid.queryString);
  const [selection, setSelection] = React.useState<SelectionState>({ base, rows: {}, allMatching: false });
  const current = selection.base === base ? selection : { base, rows: {}, allMatching: false };
  const selectedIds = Object.keys(current.rows).filter((id) => current.rows[id]);

  const applyView = React.useCallback((view: SavedView) => grid.setQuery({ ...parseGridQuery(view.query).query, page: 1 }), [grid]);
  const activeView = findActiveView(views.views, grid.queryString);
  const refetch = () => {
    void list.refetch();
  };
  const rows = (Array.isArray(list.data?.data) ? list.data.data : []) as T[];
  const total = list.data?.meta?.total ?? rows.length;
  const error = list.error ? list.error.message : null;

  return {
    grid,
    rows,
    total,
    isLoading: list.isPending,
    isFetching: list.isFetching,
    error,
    refetch,
    selectedIds,
    allMatchingSelected: current.allMatching,
    clearSelection: () => setSelection({ base, rows: {}, allMatching: false }),
    views,
    activeView,
    applyView,
    gridProps: {
      gridKey,
      queryString: grid.queryString,
      data: rows,
      total,
      page: grid.query.page,
      pageSize: grid.query.pageSize,
      onPageChange: grid.setPage,
      onPageSizeChange: grid.setPageSize,
      loading: list.isPending,
      refreshing: list.isPlaceholderData,
      error,
      onRetry: refetch,
      sort: grid.query.sort,
      onSortChange: grid.setSort,
      selection: current.rows,
      onSelectionChange: (next) => setSelection({ base, rows: next, allMatching: false }),
      allMatchingSelected: current.allMatching,
      onAllMatchingSelectedChange: (value) => setSelection({ base, rows: current.rows, allMatching: value }),
      hideToolbar: true,
    },
    toolbarProps: {
      grid,
      fields,
      views,
      activeViewId: activeView?.id ?? null,
      onApplyView: applyView,
      selectedIds,
      onRefresh: refetch,
      refreshing: list.isFetching,
    },
  };
}
