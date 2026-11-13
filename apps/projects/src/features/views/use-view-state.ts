'use client';
/**
 * Working state + saved views for the Board, List and Table (owner: views-a).
 *
 *   const view = useViewState('board');
 *   view.quick / view.settings          effective filter bar + layout settings
 *   view.setQuick({ priorities: [...] }) writes URL overrides (history.replaceState, no reload)
 *   view.visible(tasks)                  tasks passing filters, done/subtask toggles
 *   view.saveAs(name, { shared })        saves the effective state as a saved view
 *
 * The URL is the source of truth: `?view=<id>` picks a saved view; other params override it.
 * The last state per project + view type is remembered in this browser and restored when the
 * URL is bare (like Linear/Asana). Table columns are kept per view in local storage until saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { useProjectViews } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { SavedViewDTO, TaskSummary } from '@/lib/types';
import type { FilterCondition, ViewColumn } from '@/lib/view-config';
import { matchesFilters } from '@/lib/task-filters';
import { createSavedViewAction, deleteSavedViewAction, updateSavedViewAction } from '@/server/actions/views';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import {
  VIEW_PARAMS,
  applyParams,
  columnsEqual,
  configFrom,
  countActiveFilters,
  hasOverrides,
  matchesQuick,
  quickFromConfig,
  settingsFromConfig,
  stickyKey,
  writeParams,
  EMPTY_QUICK,
  type ManagedViewType,
  type QuickFilters,
  type ViewSettings,
} from './view-state';

/** `?view=all` = explicitly no saved view (even when the project has a default one). */
export const NO_VIEW = 'all';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: the view still works, it just isn't remembered.
  }
}

function replaceUrl(pathname: string, params: URLSearchParams): void {
  const query = params.toString();
  // `null` state: Next.js syncs useSearchParams for plain history calls (its own entries are skipped).
  window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
}

/** Only the params this module owns, for the sticky store. */
function ownParams(params: URLSearchParams): string {
  const own = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const value = params.get(key);
    if (value !== null) own.set(key, value);
  }
  return own.toString();
}

export interface ViewStateApi {
  readonly type: ManagedViewType;
  readonly quick: QuickFilters;
  readonly settings: ViewSettings;
  /** Conditions from a saved view the filter bar can't show (applied as-is). */
  readonly extraConditions: readonly FilterCondition[];
  readonly activeFilterCount: number;
  readonly views: readonly SavedViewDTO[];
  readonly viewsLoading: boolean;
  readonly activeView: SavedViewDTO | null;
  /** Effective state differs from the selected saved view (or from the defaults). */
  readonly dirty: boolean;
  readonly canSaveShared: boolean;
  readonly me: string;
  setQuick(patch: Partial<QuickFilters>): void;
  setSettings(patch: Partial<ViewSettings>): void;
  setColumns(columns: readonly ViewColumn[]): void;
  clearFilters(): void;
  /** Back to the saved view (or defaults): drops every override. */
  reset(): void;
  selectView(viewId: string | null): void;
  saveAs(name: string, options: { shared: boolean; isDefault: boolean }): Promise<SavedViewDTO | undefined>;
  saveChanges(): Promise<boolean>;
  renameView(viewId: string, name: string): Promise<boolean>;
  setDefaultView(viewId: string, isDefault: boolean): Promise<boolean>;
  deleteView(viewId: string): Promise<boolean>;
  canEditView(view: SavedViewDTO): boolean;
  /** Tasks passing the filter bar + done/subtask toggles (order unchanged). */
  visible(tasks: readonly TaskSummary[]): TaskSummary[];
}

export function useViewState(type: ManagedViewType): ViewStateApi {
  const { project, capabilities } = useCurrentProject();
  const { user } = useShell();
  const me = user.id;
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const viewsQuery = useProjectViews(project.key);
  const views = useMemo(() => (viewsQuery.data ?? []).filter((view) => view.type === type), [viewsQuery.data, type]);
  const canSaveShared = Boolean(capabilities['view:save_shared']);

  const viewParam = params.get('view');
  const activeView = useMemo(() => {
    if (viewParam === NO_VIEW) return null;
    if (viewParam) return views.find((view) => view.id === viewParam) ?? null;
    return views.find((view) => view.isDefault && view.userId === me) ?? views.find((view) => view.isDefault) ?? null;
  }, [me, viewParam, views]);

  const base = useMemo(() => {
    const { quick, extra } = quickFromConfig(activeView?.config);
    return { quick, extra, settings: settingsFromConfig(type, activeView?.config) };
  }, [activeView, type]);

  // Table columns: per view, kept in this browser until saved.
  const colsKey = `ks.projects.cols.${project.id}.${activeView?.id ?? 'base'}`;
  const [localColumns, setLocalColumns] = useState<readonly ViewColumn[] | null>(null);
  const [colsLoadedFor, setColsLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (type !== 'table') return;
    const raw = readStorage(colsKey);
    let parsed: readonly ViewColumn[] | null = null;
    if (raw) {
      try {
        const value = JSON.parse(raw) as unknown;
        if (Array.isArray(value)) parsed = value.filter((entry): entry is ViewColumn => Boolean(entry) && typeof (entry as ViewColumn).key === 'string');
      } catch {
        parsed = null;
      }
    }
    // Sync from storage when the selected view changes (storage is an external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalColumns(parsed);
    setColsLoadedFor(colsKey);
  }, [colsKey, type]);
  const columnsOverride = colsLoadedFor === colsKey ? localColumns : null;

  const effective = useMemo(() => {
    const applied = applyParams(new URLSearchParams(params.toString()), base);
    return columnsOverride ? { ...applied, settings: { ...applied.settings, columns: columnsOverride } } : applied;
  }, [base, columnsOverride, params]);

  // Restore the last state when the URL carries no view params (once per mount).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const current = new URLSearchParams(window.location.search);
    if (current.has('view') || hasOverrides(current)) return;
    const sticky = readStorage(stickyKey(project.id, type));
    if (!sticky) return;
    const saved = new URLSearchParams(sticky);
    for (const [key, value] of saved) current.set(key, value);
    replaceUrl(window.location.pathname, current);
  }, [project.id, type]);

  // Remember the state (only this module's params) for next time.
  useEffect(() => {
    if (!restored.current) return;
    const own = ownParams(new URLSearchParams(params.toString()));
    writeStorage(stickyKey(project.id, type), own || null);
  }, [params, project.id, type]);

  const latest = useRef({ base, effective, pathname });
  useEffect(() => {
    latest.current = { base, effective, pathname };
  });

  const commit = useCallback((next: { quick: QuickFilters; settings: ViewSettings }) => {
    const { base: currentBase, pathname: path } = latest.current;
    const out = writeParams(new URLSearchParams(window.location.search), currentBase, next);
    replaceUrl(path, out);
  }, []);

  const setQuick = useCallback(
    (patch: Partial<QuickFilters>) => {
      const { effective: current } = latest.current;
      commit({ quick: { ...current.quick, ...patch }, settings: current.settings });
    },
    [commit],
  );

  const setSettings = useCallback(
    (patch: Partial<ViewSettings>) => {
      const { effective: current } = latest.current;
      const { columns, ...rest } = patch;
      if (columns) {
        setLocalColumns(columns);
        writeStorage(colsKey, JSON.stringify(columns));
      }
      if (Object.keys(rest).length) commit({ quick: current.quick, settings: { ...current.settings, ...rest } });
    },
    [colsKey, commit],
  );

  const setColumns = useCallback((columns: readonly ViewColumn[]) => setSettings({ columns }), [setSettings]);

  const clearFilters = useCallback(() => {
    const { effective: current } = latest.current;
    commit({ quick: { ...EMPTY_QUICK }, settings: current.settings });
  }, [commit]);

  const dropOverrides = useCallback(
    (viewId: string | null | undefined) => {
      const out = new URLSearchParams(window.location.search);
      for (const key of VIEW_PARAMS) out.delete(key);
      if (viewId !== undefined) {
        if (viewId) out.set('view', viewId);
        else out.set('view', NO_VIEW);
      } else if (params.get('view')) out.set('view', params.get('view') as string);
      replaceUrl(latest.current.pathname, out);
      setLocalColumns(null);
      writeStorage(colsKey, null);
    },
    [colsKey, params],
  );

  const reset = useCallback(() => dropOverrides(undefined), [dropOverrides]);

  const selectView = useCallback(
    (viewId: string | null) => {
      const out = new URLSearchParams(window.location.search);
      for (const key of VIEW_PARAMS) out.delete(key);
      out.set('view', viewId ?? NO_VIEW);
      replaceUrl(latest.current.pathname, out);
    },
    [],
  );

  const invalidateViews = useCallback(() => queryClient.invalidateQueries({ queryKey: qk.projectViews(project.key) }), [project.key, queryClient]);

  const saveAs = useCallback(
    async (name: string, options: { shared: boolean; isDefault: boolean }) => {
      const { effective: current } = latest.current;
      const result = await createSavedViewAction({
        projectId: project.id,
        name,
        type,
        config: configFrom(current.quick, current.settings, type) as Record<string, unknown>,
        shared: options.shared,
        isDefault: options.isDefault,
      });
      if (!result.ok) {
        toast.error("Couldn't save the view", result.error.message);
        return undefined;
      }
      queryClient.setQueryData<SavedViewDTO[]>(qk.projectViews(project.key), (list) => (Array.isArray(list) ? [...list, result.data] : list));
      await invalidateViews();
      const out = new URLSearchParams(window.location.search);
      for (const key of VIEW_PARAMS) out.delete(key);
      out.set('view', result.data.id);
      replaceUrl(latest.current.pathname, out);
      setLocalColumns(null);
      writeStorage(colsKey, null);
      toast.success(`Saved “${result.data.name}”`, options.shared ? 'Everyone on this project can use it.' : 'Only you can see it.');
      return result.data;
    },
    [colsKey, invalidateViews, project.id, project.key, queryClient, type],
  );

  const saveChanges = useCallback(async () => {
    if (!activeView) return false;
    const { effective: current } = latest.current;
    const config = configFrom(current.quick, current.settings, type);
    const result = await updateSavedViewAction({ viewId: activeView.id, patch: { config: config as Record<string, unknown> } });
    if (!result.ok) {
      toast.error("Couldn't save the view", result.error.message);
      return false;
    }
    queryClient.setQueryData<SavedViewDTO[]>(qk.projectViews(project.key), (list) =>
      Array.isArray(list) ? list.map((view) => (view.id === result.data.id ? result.data : view)) : list,
    );
    void invalidateViews();
    dropOverrides(activeView.id);
    toast.success(`Saved changes to “${activeView.name}”`);
    return true;
  }, [activeView, dropOverrides, invalidateViews, project.key, queryClient, type]);

  const renameView = useCallback(
    async (viewId: string, name: string) => {
      const result = await updateSavedViewAction({ viewId, patch: { name } });
      if (!result.ok) {
        toast.error("Couldn't rename the view", result.error.message);
        return false;
      }
      queryClient.setQueryData<SavedViewDTO[]>(qk.projectViews(project.key), (list) =>
        Array.isArray(list) ? list.map((view) => (view.id === viewId ? result.data : view)) : list,
      );
      void invalidateViews();
      return true;
    },
    [invalidateViews, project.key, queryClient],
  );

  const setDefaultView = useCallback(
    async (viewId: string, isDefault: boolean) => {
      const result = await updateSavedViewAction({ viewId, patch: { isDefault } });
      if (!result.ok) {
        toast.error("Couldn't change the default view", result.error.message);
        return false;
      }
      await invalidateViews();
      toast.success(isDefault ? `“${result.data.name}” now opens first` : 'Default view removed');
      return true;
    },
    [invalidateViews],
  );

  const deleteView = useCallback(
    async (viewId: string) => {
      const view = views.find((entry) => entry.id === viewId);
      const result = await deleteSavedViewAction({ viewId });
      if (!result.ok) {
        toast.error("Couldn't delete the view", result.error.message);
        return false;
      }
      queryClient.setQueryData<SavedViewDTO[]>(qk.projectViews(project.key), (list) => (Array.isArray(list) ? list.filter((entry) => entry.id !== viewId) : list));
      void invalidateViews();
      if (activeView?.id === viewId) {
        const out = new URLSearchParams(window.location.search);
        out.delete('view');
        replaceUrl(latest.current.pathname, out);
      }
      if (view) {
        toast.undo(`Deleted “${view.name}”`, {
          onUndo: async () => {
            const again = await createSavedViewAction({
              projectId: project.id,
              name: view.name,
              type: view.type,
              config: view.config as Record<string, unknown>,
              shared: view.userId === null,
              isDefault: view.isDefault,
            });
            if (!again.ok) throw new Error(again.error.message);
            await invalidateViews();
          },
        });
      }
      return true;
    },
    [activeView?.id, invalidateViews, project.id, project.key, queryClient, views],
  );

  const canEditView = useCallback((view: SavedViewDTO) => (view.userId ? view.userId === me : canSaveShared), [canSaveShared, me]);

  const { quick, settings } = effective;
  const extraConditions = base.extra;
  const visible = useCallback(
    (tasks: readonly TaskSummary[]) => {
      const extra = extraConditions.length ? { match: 'all' as const, conditions: extraConditions } : undefined;
      return tasks.filter((task) => {
        if (!settings.showSubtasks && task.parentTaskId) return false;
        if (!settings.showCompleted && (task.statusCategory === 'done' || task.statusCategory === 'cancelled')) return false;
        if (!matchesQuick(task, quick, me)) return false;
        if (extra && !matchesFilters(task, extra, { me })) return false;
        return true;
      });
    },
    [extraConditions, me, quick, settings.showCompleted, settings.showSubtasks],
  );

  const dirty = useMemo(() => {
    const own = new URLSearchParams(params.toString());
    if (hasOverrides(own)) {
      // Overrides equal to the base are never written, so any override means a real change.
      return true;
    }
    return type === 'table' && columnsOverride !== null && !columnsEqual(columnsOverride, base.settings.columns);
  }, [base.settings.columns, columnsOverride, params, type]);

  return {
    type,
    quick,
    settings,
    extraConditions,
    activeFilterCount: countActiveFilters(quick) + extraConditions.length,
    views,
    viewsLoading: viewsQuery.isLoading,
    activeView,
    dirty,
    canSaveShared,
    me,
    setQuick,
    setSettings,
    setColumns,
    clearFilters,
    reset,
    selectView,
    saveAs,
    saveChanges,
    renameView,
    setDefaultView,
    deleteView,
    canEditView,
    visible,
  };
}
