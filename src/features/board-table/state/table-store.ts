'use client';

/**
 * Per-table UI state (selection, focus, expansion, collapse, drag, flashes). One vanilla
 * zustand store per <BoardTable>, so rows subscribe to just the slice they render and a
 * selection change re-renders only the affected rows.
 */
import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { rangeIds, toggleMany, toggleOne } from '../lib/ordering';

export interface FocusCell {
  readonly rowKey: string;
  readonly col: number;
}

export interface DropIndicator {
  readonly rowKey: string;
  readonly side: 'before' | 'after';
}

export interface TableUiState {
  readonly selected: ReadonlySet<string>;
  readonly anchorId: string | null;
  readonly focus: FocusCell | null;
  readonly editingName: {
    readonly itemId: string;
    readonly seed: string | null;
    readonly selectAll: boolean;
  } | null;
  readonly expanded: ReadonlySet<string>;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly liveWidths: Readonly<Record<string, number>>;
  readonly renameColumnId: string | null;
  readonly renameGroupId: string | null;
  /** Which column-header row hosts inline column renames: 'overlay' or a group id (one input at a time). */
  readonly renameHost: string | null;
  readonly dragKind: 'item' | 'group' | 'column' | null;
  readonly dragColumnKey: string | null;
  /** Ids being dragged (items, or the one group). */
  readonly dragIds: ReadonlySet<string>;
  readonly drop: DropIndicator | null;
  readonly flashes: Readonly<Record<string, readonly string[]>>;
  readonly columnDialog: {
    readonly columnId: string;
    readonly kind: 'settings' | 'labels' | 'filter';
  } | null;
}

export interface TableUiActions {
  readonly toggleSelect: (id: string, options?: { range?: boolean; orderedIds?: readonly string[] }) => void;
  readonly selectMany: (ids: readonly string[]) => void;
  readonly setSelection: (ids: readonly string[]) => void;
  readonly clearSelection: () => void;
  readonly setFocus: (focus: FocusCell | null) => void;
  readonly editName: (itemId: string | null, seed?: string | null, selectAll?: boolean) => void;
  readonly toggleExpanded: (itemId: string, open?: boolean) => void;
  readonly setCollapsedGroups: (ids: Iterable<string>) => void;
  readonly toggleGroup: (groupId: string) => void;
  readonly setLiveWidth: (key: string, width: number | null) => void;
  readonly setRenameColumn: (id: string | null) => void;
  readonly setRenameGroup: (id: string | null) => void;
  readonly setRenameHost: (host: string | null) => void;
  readonly setDrag: (
    kind: TableUiState['dragKind'],
    columnKey?: string | null,
    ids?: readonly string[],
  ) => void;
  readonly setDrop: (drop: DropIndicator | null) => void;
  /** Replace all realtime flashes (item id → changed column keys). */
  readonly setFlashes: (flashes: Readonly<Record<string, readonly string[]>>) => void;
  readonly openColumnDialog: (dialog: TableUiState['columnDialog']) => void;
}

export type TableStore = StoreApi<TableUiState & TableUiActions>;

const EMPTY: ReadonlySet<string> = new Set();

export function createTableStore(initialCollapsed: Iterable<string> = []): TableStore {
  return createStore<TableUiState & TableUiActions>((set) => ({
    selected: EMPTY,
    anchorId: null,
    focus: null,
    editingName: null,
    expanded: EMPTY,
    collapsedGroups: new Set(initialCollapsed),
    liveWidths: {},
    renameColumnId: null,
    renameGroupId: null,
    renameHost: null,
    dragKind: null,
    dragColumnKey: null,
    dragIds: EMPTY,
    drop: null,
    flashes: {},
    columnDialog: null,
    openColumnDialog: (columnDialog) => set({ columnDialog }),
    toggleSelect: (id, options) =>
      set((state) => {
        if (options?.range && options.orderedIds && state.anchorId) {
          const ids = rangeIds(options.orderedIds, state.anchorId, id);
          const next = new Set(state.selected);
          for (const entry of ids) next.add(entry);
          return { selected: next };
        }
        return { selected: toggleOne(state.selected, id), anchorId: id };
      }),
    selectMany: (ids) =>
      set((state) => ({ selected: toggleMany(state.selected, ids), anchorId: ids.at(-1) ?? state.anchorId })),
    setSelection: (ids) => set({ selected: new Set(ids), anchorId: ids.at(-1) ?? null }),
    clearSelection: () => set({ selected: EMPTY, anchorId: null }),
    setFocus: (focus) => set({ focus }),
    editName: (itemId, seed = null, selectAll = false) =>
      set({ editingName: itemId ? { itemId, seed, selectAll } : null }),
    toggleExpanded: (itemId, open) =>
      set((state) => {
        const isOpen = state.expanded.has(itemId);
        if (open === isOpen) return {};
        const next = new Set(state.expanded);
        if (isOpen) next.delete(itemId);
        else next.add(itemId);
        return { expanded: next };
      }),
    setCollapsedGroups: (ids) => set({ collapsedGroups: new Set(ids) }),
    toggleGroup: (groupId) =>
      set((state) => ({ collapsedGroups: toggleOne(state.collapsedGroups, groupId) })),
    setLiveWidth: (key, width) =>
      set((state) => {
        const next = { ...state.liveWidths };
        if (width === null) delete next[key];
        else next[key] = width;
        return { liveWidths: next };
      }),
    setRenameColumn: (id) => set({ renameColumnId: id }),
    setRenameGroup: (id) => set({ renameGroupId: id }),
    setRenameHost: (renameHost) => set({ renameHost }),
    setDrag: (kind, columnKey = null, ids = []) =>
      set({
        dragKind: kind,
        dragColumnKey: columnKey,
        dragIds: ids.length ? new Set(ids) : EMPTY,
        ...(kind === null && { drop: null }),
      }),
    setDrop: (drop) =>
      set((state) =>
        state.drop?.rowKey === drop?.rowKey && state.drop?.side === drop?.side ? {} : { drop },
      ),
    setFlashes: (flashes) => set({ flashes }),
  }));
}

export const TableStoreContext = createContext<TableStore | null>(null);

export function useTableStoreApi(): TableStore {
  const store = useContext(TableStoreContext);
  if (!store) throw new Error('useTableStore must be used inside <BoardTable>');
  return store;
}

export function useTableStore<T>(selector: (state: TableUiState & TableUiActions) => T): T {
  return useStore(useTableStoreApi(), selector);
}

/** Persist collapsed groups per board for this browser. */
export function loadCollapsed(boardId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(`kitstak.board-table.collapsed.${boardId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : null;
  } catch {
    return null;
  }
}

export function saveCollapsed(boardId: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(`kitstak.board-table.collapsed.${boardId}`, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private mode / quota): collapse state just isn't remembered.
  }
}
