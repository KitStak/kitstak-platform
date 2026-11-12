'use client';

/**
 * Shared table view state for the board table AND the board toolbar. Both call
 * `useBoardTableState(boardId, view)` and see the same state:
 *
 * - With a saved view (`view.id`), state lives in the view's `config` (read from the board
 *   payload cache, written optimistically through `useUpdateView`).
 * - Without a view, state lives in a per-board in-memory store.
 * - `search` is always transient (never written on every keystroke).
 */
import { useCallback, useMemo } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { useBoard, useUpdateView } from '@/lib/hooks';
import type { ViewDto } from '@/server/services/contracts/dto';
import type { CellDensity } from '@/features/cells';
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  parseViewConfig,
  sortBy,
  toggleKey,
  toggleLabelFilter,
  type FilterGroup,
  type FilterRule,
  type SortRule,
  type TableViewState,
} from '../lib/view-state';

interface LocalState {
  readonly config: Record<string, unknown>;
  readonly search: string;
}

const stores = new Map<string, StoreApi<LocalState>>();

function localStore(key: string): StoreApi<LocalState> {
  let store = stores.get(key);
  if (!store) {
    store = createStore<LocalState>(() => ({ config: {}, search: '' }));
    stores.set(key, store);
  }
  return store;
}

export interface BoardTableStateApi {
  readonly state: TableViewState;
  /** True when changes are saved to a view (otherwise they only last for the session). */
  readonly persisted: boolean;
  readonly hasFilters: boolean;
  readonly setFilters: (filters: FilterGroup) => void;
  readonly addFilterRule: (rule: FilterRule) => void;
  readonly removeFilterRule: (columnKey: string) => void;
  readonly toggleLabelFilter: (columnKey: string, labelId: string | null) => void;
  readonly clearFilters: () => void;
  readonly setSort: (sort: readonly SortRule[]) => void;
  readonly sortColumn: (columnKey: string, direction: 'asc' | 'desc') => void;
  readonly setSearch: (search: string) => void;
  readonly setPersonFilter: (userId: string | null) => void;
  readonly setHiddenColumns: (keys: readonly string[]) => void;
  readonly toggleHiddenColumn: (key: string) => void;
  readonly setColumnWidth: (key: string, width: number) => void;
  readonly setColumnWidths: (widths: Readonly<Record<string, number>>) => void;
  readonly toggleCollapsedColumn: (key: string) => void;
  readonly setDensity: (density: CellDensity) => void;
}

export function useBoardTableState(
  boardId: string,
  view?: Pick<ViewDto, 'id' | 'config'> | null,
): BoardTableStateApi {
  const board = useBoard(boardId);
  const updateView = useUpdateView(boardId);
  const viewId = view?.id ?? null;
  const store = localStore(`${boardId}:${viewId ?? 'local'}`);
  const local = useStore(store);

  const cachedConfig = useMemo(() => {
    if (!viewId) return local.config;
    return board.data?.views.find((entry) => entry.id === viewId)?.config ?? view?.config ?? {};
  }, [board.data?.views, local.config, view?.config, viewId]);

  const state = useMemo(
    () => parseViewConfig(cachedConfig, { search: local.search }),
    [cachedConfig, local.search],
  );

  const write = useCallback(
    (patch: Record<string, unknown>) => {
      if (viewId) updateView.mutate({ viewId, input: { config: patch as never } });
      else store.setState((current) => ({ ...current, config: { ...current.config, ...patch } }));
    },
    // updateView.mutate is stable per TanStack Query; the object itself is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, viewId, updateView.mutate],
  );

  return useMemo<BoardTableStateApi>(
    () => ({
      state,
      persisted: Boolean(viewId),
      hasFilters: hasActiveFilters(state),
      setFilters: (filters) => write({ filters }),
      addFilterRule: (rule) =>
        write({
          filters: {
            ...state.filters,
            rules: [...state.filters.rules.filter((entry) => entry.columnKey !== rule.columnKey), rule],
          },
        }),
      removeFilterRule: (columnKey) =>
        write({
          filters: {
            ...state.filters,
            rules: state.filters.rules.filter((rule) => rule.columnKey !== columnKey),
          },
        }),
      toggleLabelFilter: (columnKey, labelId) =>
        write({ filters: toggleLabelFilter(state.filters, columnKey, labelId) }),
      clearFilters: () => {
        write({ filters: EMPTY_FILTERS, personFilter: null });
        store.setState((current) => ({ ...current, search: '' }));
      },
      setSort: (sort) => write({ sort }),
      sortColumn: (columnKey, direction) => write({ sort: sortBy(columnKey, direction) }),
      setSearch: (search) => store.setState((current) => ({ ...current, search })),
      setPersonFilter: (userId) => write({ personFilter: userId }),
      setHiddenColumns: (keys) => write({ hiddenColumnKeys: [...keys] }),
      toggleHiddenColumn: (key) => write({ hiddenColumnKeys: toggleKey(state.hiddenColumnKeys, key) }),
      setColumnWidth: (key, width) =>
        write({ columnWidths: { ...state.columnWidths, [key]: Math.round(width) } }),
      setColumnWidths: (widths) => write({ columnWidths: { ...state.columnWidths, ...widths } }),
      toggleCollapsedColumn: (key) =>
        write({ collapsedColumnKeys: toggleKey(state.collapsedColumnKeys, key) }),
      setDensity: (density) => write({ density }),
    }),
    [state, store, viewId, write],
  );
}
