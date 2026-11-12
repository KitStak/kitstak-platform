'use client';

/**
 * The board's working view state: the active view's saved config + unsaved toolbar changes.
 *
 * The board table and the toolbar share `useBoardTableState(boardId, null)` (the table's
 * session store), which we seed from the active view's saved config and the URL overlay
 * whenever the view changes. Toolbar changes (filters, sort, person, hidden, group by) stay
 * temporary until "Save to this view"; layout changes (widths, row height, collapsed columns)
 * are saved to the view automatically. The unsaved part is mirrored into the URL (`?vs=`),
 * so links reproduce exactly what the sender saw.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui';
import { parseViewConfig, useBoardTableState, type BoardTableStateApi } from '@/features/board-table';
import { useUpdateView } from '@/lib/hooks';
import type { ColumnDto, ViewDto } from '@/server/services/contracts/dto';
import {
  applyOverlay,
  configPatch,
  dirtyKeys,
  draftFromConfig,
  externalAdoptions,
  filtersForConfig,
  sameDraft,
  draftFromState,
  layoutPatch,
  overlayOf,
  type DraftKey,
  type GroupBySpec,
  type ToolbarDraft,
} from '../lib/draft';
import { patchBoardSearch, readBoardUrl, sanitizeOverlay } from '../lib/url-state';

const URL_DEBOUNCE_MS = 250;
const LAYOUT_DEBOUNCE_MS = 700;
/** How long a failed save may still be "rolling back" before external syncs resume. */
const ROLLBACK_GRACE_MS = 4_000;

export interface WorkingState {
  readonly table: BoardTableStateApi;
  readonly working: ToolbarDraft;
  readonly saved: ToolbarDraft;
  readonly groupBy: GroupBySpec | null;
  readonly setGroupBy: (spec: GroupBySpec | null) => void;
  readonly dirty: readonly DraftKey[];
  readonly isDirty: boolean;
  /** False until the active view's state has been applied (the canvas waits for it). */
  readonly ready: boolean;
  readonly saving: boolean;
  readonly save: () => void;
  readonly reset: () => void;
  /** The view as other view types should see it (working filters / person / search applied). */
  readonly effectiveView: ViewDto | null;
}

interface Options {
  readonly boardId: string;
  readonly view: ViewDto | null;
  readonly defaultViewId: string | null;
  readonly columns: readonly ColumnDto[];
  readonly canEdit: boolean;
  readonly users?: readonly { readonly id: string }[];
}

function applyDraft(table: BoardTableStateApi, draft: ToolbarDraft): void {
  table.setFilters(draft.filters);
  table.setSort(draft.sort);
  table.setPersonFilter(draft.personFilter);
  table.setHiddenColumns(draft.hiddenColumnKeys);
}

export function useWorkingState({ boardId, view, defaultViewId, columns, canEdit, users = [] }: Options): WorkingState {
  const table = useBoardTableState(boardId, null);
  const updateView = useUpdateView(boardId);
  const viewId = view?.id ?? null;
  const key = `${boardId}:${viewId ?? 'none'}`;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [groupBy, setGroupByState] = useState<GroupBySpec | null>(null);
  const ready = seededKey === key;

  const savedConfig = view?.config;
  const saved = useMemo(() => draftFromConfig(savedConfig ?? {}), [savedConfig]);
  const savedLayout = useMemo(() => parseViewConfig(savedConfig ?? {}), [savedConfig]);
  const defaultWidths = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.key, column.width])),
    [columns],
  );
  const working = useMemo(() => draftFromState(table.state, groupBy), [table.state, groupBy]);

  // Latest values for effects that must not re-run on every change.
  const latest = useRef({ table, saved, savedLayout, defaultWidths, columns, users });
  useLayoutEffect(() => {
    latest.current = { table, saved, savedLayout, defaultWidths, columns, users };
  });

  // Seed on view change: saved config + URL overlay (only when the URL targets this view).
  useLayoutEffect(() => {
    if (seededKey === key) return;
    const { table: api, saved: base, savedLayout: layout, defaultWidths: widths, columns: cols, users: people } = latest.current;
    const url = readBoardUrl(new URLSearchParams(window.location.search));
    const targetsThis = url.viewId ? url.viewId === viewId : viewId === defaultViewId;
    // Links are untrusted: drop rules / sort / hidden keys / grouping on unknown columns.
    const draft = applyOverlay(base, targetsThis ? sanitizeOverlay(url.overlay, cols, people) : null);
    applyDraft(api, draft);
    api.setDensity(layout.density);
    const resetWidths: Record<string, number> = {};
    for (const columnKey of Object.keys(api.state.columnWidths)) {
      const width = layout.columnWidths[columnKey] ?? widths[columnKey];
      if (width) resetWidths[columnKey] = width;
    }
    api.setColumnWidths({ ...resetWidths, ...layout.columnWidths });
    api.setSearch(targetsThis ? url.search : '');
    setGroupByState(draft.groupBy);
    setSeededKey(key);
  }, [defaultViewId, key, seededKey, viewId]);

  const collapseTouched = useRef(false);
  // Collapsed columns can only be toggled one at a time: converge one key per render.
  useEffect(() => {
    if (!ready) return;
    const wanted = new Set(savedLayout.collapsedColumnKeys);
    const current = new Set(table.state.collapsedColumnKeys);
    const differing = [...wanted, ...current].find((entry) => wanted.has(entry) !== current.has(entry));
    if (differing && !collapseTouched.current) table.toggleCollapsedColumn(differing);
    else collapseTouched.current = true;
  }, [ready, savedLayout.collapsedColumnKeys, table]);
  useLayoutEffect(() => {
    collapseTouched.current = false;
  }, [key]);

  // Our own in-flight "Save to this view": the saved state it started from. A rollback to it is
  // not an external save (see `externalAdoptions`).
  const pendingSave = useRef<{ from: ToolbarDraft; timer: number | null } | null>(null);
  useEffect(
    () => () => {
      if (pendingSave.current?.timer) window.clearTimeout(pendingSave.current.timer);
    },
    [],
  );

  // Someone saved the view elsewhere: adopt their values for keys we haven't touched.
  const previousSaved = useRef(saved);
  useEffect(() => {
    const before = previousSaved.current;
    previousSaved.current = saved;
    if (!ready || before === saved) return;
    const api = latest.current.table;
    const pending = pendingSave.current;
    if (pending && sameDraft(saved, pending.from)) {
      // Our save failed and the cache rolled back: keep the user's changes (still dirty).
      if (pending.timer) window.clearTimeout(pending.timer);
      pendingSave.current = null;
      return;
    }
    for (const draftKey of externalAdoptions(before, saved, working, pending?.from ?? null)) {
      // Syncing from an external change (someone else saved the view): intended.
      if (draftKey === 'groupBy') setGroupByState(saved.groupBy);
      else if (draftKey === 'filters') api.setFilters(saved.filters);
      else if (draftKey === 'sort') api.setSort(saved.sort);
      else if (draftKey === 'personFilter') api.setPersonFilter(saved.personFilter);
      else api.setHiddenColumns(saved.hiddenColumnKeys);
    }
    // `working` is read at the moment the saved config changes, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, saved]);

  const dirty = useMemo(() => (ready ? dirtyKeys(working, saved) : []), [ready, saved, working]);

  // Mirror view + unsaved overlay + search into the URL (replaceState: no history spam).
  const search = table.state.search;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const next = patchBoardSearch(window.location.search, {
        viewId: viewId && viewId !== defaultViewId ? viewId : null,
        overlay: overlayOf(working, saved),
        search,
      });
      if (next !== window.location.search) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
      }
    }, URL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [defaultViewId, ready, saved, search, viewId, working]);

  // Auto-save layout tweaks to the view (editors only).
  const { columnWidths, density, collapsedColumnKeys } = table.state;
  const mutateView = updateView.mutate;
  useEffect(() => {
    if (!ready || !viewId || !canEdit) return;
    const patch = layoutPatch({ columnWidths, density, collapsedColumnKeys }, savedLayout, defaultWidths);
    if (!patch) return;
    const timer = window.setTimeout(() => mutateView({ viewId, input: { config: patch as never } }), LAYOUT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canEdit, collapsedColumnKeys, columnWidths, defaultWidths, density, mutateView, ready, savedLayout, viewId]);

  const save = useCallback(() => {
    if (!viewId || dirty.length === 0) return;
    if (pendingSave.current?.timer) window.clearTimeout(pendingSave.current.timer);
    pendingSave.current = { from: saved, timer: null };
    mutateView(
      { viewId, input: { config: configPatch(working, dirty) as never } },
      {
        onSuccess: () => {
          pendingSave.current = null;
          toast.success('Saved to this view', 'Everyone who opens this view now sees these settings.');
        },
        onError: () => {
          // The rollback re-render clears this; the timer is a safety net if it never comes.
          const pending = pendingSave.current;
          if (pending)
            pending.timer = window.setTimeout(() => {
              if (pendingSave.current === pending) pendingSave.current = null;
            }, ROLLBACK_GRACE_MS);
        },
      },
    );
  }, [dirty, mutateView, saved, viewId, working]);

  const reset = useCallback(() => {
    applyDraft(latest.current.table, saved);
    setGroupByState(saved.groupBy);
  }, [saved]);

  const effectiveView = useMemo<ViewDto | null>(() => {
    if (!view) return null;
    return {
      ...view,
      config: {
        ...view.config,
        filters: filtersForConfig(working.filters),
        personFilter: working.personFilter,
        sort: [...working.sort],
        hiddenColumnKeys: [...working.hiddenColumnKeys],
        search,
      },
    };
  }, [search, view, working.filters, working.hiddenColumnKeys, working.personFilter, working.sort]);

  return {
    table,
    working,
    saved,
    groupBy,
    setGroupBy: setGroupByState,
    dirty,
    isDirty: dirty.length > 0,
    ready,
    saving: updateView.isPending,
    save,
    reset,
    effectiveView,
  };
}
