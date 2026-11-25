'use client';

/**
 * Dashboard data hooks: insights (per widget, with dashboard filters), wizard sources and every
 * dashboard/widget mutation. Mutations are optimistic with rollback + error toast; destructive
 * ones offer Undo.
 */
import { useCallback } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { useOptionalOrg } from '@/features/shell/org-context';
import { toastError, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { DashboardDto, DashboardWidgetDto, WidgetType } from '@/server/services/contracts/dto';
import type {
  CreateDashboardFlowInput,
  DashboardSettings,
  DashboardSourcesDto,
  InsightBatchDto,
  InsightDto,
  InsightFilters,
} from '@/server/services/contracts/dashboard-insights';
import { InsightBatcher } from './lib/insight-batcher';
import type { GridItem } from './lib/layout';

export interface WidgetQueryShape {
  readonly type: WidgetType;
  readonly config: Record<string, unknown>;
}

export const dashboardKeys = {
  sources: (orgId: string) => ['org', orgId, 'dashboard-sources'] as const,
  insight: (orgId: string, widgetId: string, filters: InsightFilters, configHash: string) =>
    ['org', orgId, 'widget', widgetId, 'insight', filters, configHash] as const,
  preview: (orgId: string, dashboardId: string, widget: WidgetQueryShape, filters: InsightFilters) =>
    ['org', orgId, 'widget-preview', dashboardId, widget.type, widget.config, filters] as const,
};

function post<T>(orgId: string, path: string, body: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST'): Promise<T> {
  return apiRequest<T>(path, { orgId, method, body });
}

export function useDashboardSources() {
  const orgId = useOrgId();
  // A guest may not read dashboards (the server answers 403), and nothing a guest can open uses
  // the sources. So the request is not made for them (billing review round 5). Outside the shell
  // (dev harnesses) it runs as before.
  const permissions = useOptionalOrg()?.permissions;
  const canRead = permissions?.includes('dashboard:read') ?? true;
  return useQuery({
    queryKey: dashboardKeys.sources(orgId),
    queryFn: ({ signal }) => apiRequest<DashboardSourcesDto>('/dashboard-data/sources', { orgId, signal }),
    staleTime: 5 * 60_000,
    enabled: canRead,
  });
}

const batchers = new Map<string, InsightBatcher>();

/** One batcher per org (the org travels as a header). */
function batcherFor(orgId: string): InsightBatcher {
  const existing = batchers.get(orgId);
  if (existing) return existing;
  const batcher = new InsightBatcher((dashboardId, body) =>
    apiRequest<InsightBatchDto>(`/dashboard-data/${dashboardId}/batch`, { orgId, method: 'POST', body }),
  );
  batchers.set(orgId, batcher);
  return batcher;
}

/** Small stable hash so the same widget with two configs never collides inside one batch. */
function hashConfig(json: string): string {
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) hash = ((hash << 5) + hash + json.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

/** Saved widget data (batched per dashboard + filters). `refetchInterval` drives auto refresh. */
export function useWidgetInsight(
  dashboardId: string,
  widget: DashboardWidgetDto,
  filters: InsightFilters,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  const orgId = useOrgId();
  const configJson = JSON.stringify(widget.config);
  return useQuery({
    queryKey: dashboardKeys.insight(orgId, widget.id, filters, configJson),
    queryFn: () =>
      batcherFor(orgId).load(dashboardId, filters, {
        key: `${widget.id}:${hashConfig(configJson)}`,
        type: widget.type,
        config: widget.config,
      }),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? false,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Refresh every widget, bypassing the server's few-second dataset cache. */
export function useRefreshWidgets() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useCallback(() => {
    batcherFor(orgId).markFresh();
    return queryClient.invalidateQueries({ queryKey: ['org', orgId, 'widget'] });
  }, [orgId, queryClient]);
}

/** Put already-computed data (e.g. the wizard preview) under a saved widget's insight key. */
export function seedWidgetInsight(
  queryClient: QueryClient,
  orgId: string,
  widget: Pick<DashboardWidgetDto, 'id' | 'config'>,
  filters: InsightFilters,
  data: InsightDto,
): void {
  queryClient.setQueryData(dashboardKeys.insight(orgId, widget.id, filters, JSON.stringify(widget.config)), data);
}

/** Live preview of an unsaved widget configuration (wizard + settings panel). */
export function useWidgetPreview(dashboardId: string, widget: WidgetQueryShape, filters: InsightFilters) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: dashboardKeys.preview(orgId, dashboardId, widget, filters),
    queryFn: ({ signal }) =>
      apiRequest<InsightDto>(`/dashboard-data/${dashboardId}/query`, {
        orgId,
        method: 'POST',
        body: { widget, filters },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

type WidgetInput = Omit<DashboardWidgetDto, 'id' | 'dashboardId'>;

const PENDING_PREFIX = 'pending-';
/** Optimistic widgets carry a temporary id until the server row arrives. */
export function isPendingWidgetId(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}
let pendingSeq = 0;
/** Lets an Undo wait for the in-flight DELETE before re-creating the widget. */
interface DeleteOutcome {
  undone: boolean;
  readonly settled: Promise<boolean>;
  readonly resolve: (deleted: boolean) => void;
}
function deleteOutcome(): DeleteOutcome {
  let resolve: (deleted: boolean) => void = () => undefined;
  const settled = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { undone: false, settled, resolve };
}

type WidgetPatch = Partial<Omit<DashboardWidgetDto, 'id' | 'dashboardId' | 'type'>>;
type DashboardPatch = { name?: string; description?: string | null; boardIds?: string[] };

/** Every dashboard + widget mutation, optimistic against the dashboard query. */
export function useDashboardActions(dashboardId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = queryKeys.dashboard(orgId, dashboardId);
  // Shared by every write so the realtime hook can hold refetches while one is in flight.
  const mutationKey = ['dashboard', dashboardId] as const;

  const patchCache = async (updater: (dashboard: DashboardDto) => DashboardDto) => {
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<DashboardDto>(key);
    if (previous) queryClient.setQueryData<DashboardDto>(key, updater(previous));
    return { previous };
  };
  const rollback = (context: { previous?: DashboardDto } | undefined) => {
    if (context?.previous) queryClient.setQueryData(key, context.previous);
  };
  const settle = () => queryClient.invalidateQueries({ queryKey: key });
  const refreshLists = () => queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboards'] });

  const update = useMutation({
    mutationKey,
    mutationFn: (input: DashboardPatch) => post<DashboardDto>(orgId, `/dashboards/${dashboardId}`, input, 'PATCH'),
    onMutate: (input) =>
      patchCache((dashboard) => ({
        ...dashboard,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.boardIds ? { config: { ...dashboard.config, boardIds: input.boardIds } } : {}),
      })),
    onError: (error, _input, context) => {
      rollback(context);
      toastError(error, 'Could not update the dashboard');
    },
    onSuccess: (dashboard, input) => {
      queryClient.setQueryData(key, dashboard);
      if (input.boardIds) void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'widget'] });
      if (input.name !== undefined) {
        void refreshLists();
        void queryClient.invalidateQueries({ queryKey: queryKeys.favorites(orgId) });
        void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'workspaces'] });
      }
    },
  });

  const updateSettings = useMutation({
    mutationKey,
    mutationFn: (settings: DashboardSettings) =>
      post<DashboardDto>(orgId, `/dashboard-data/${dashboardId}/settings`, settings, 'PATCH'),
    onMutate: (settings) => patchCache((dashboard) => ({ ...dashboard, config: { ...dashboard.config, ...settings } })),
    onError: (error, _input, context) => {
      rollback(context);
      toastError(error, 'Could not save dashboard settings');
    },
    onSuccess: (dashboard) => queryClient.setQueryData(key, dashboard),
  });

  const saveLayout = useMutation({
    mutationKey,
    // Layout saves run one at a time, in order, so a quick Undo can never land before the move.
    scope: { id: `dashboard-layout-${dashboardId}` },
    mutationFn: async (widgets: readonly GridItem[]) => {
      // Widgets still being created have no server row yet; their slot is saved on insert.
      const saved = widgets.filter((widget) => !isPendingWidgetId(widget.id));
      if (saved.length === 0) return queryClient.getQueryData<DashboardDto>(key);
      return post<DashboardDto>(orgId, `/dashboard-data/${dashboardId}/layout`, { widgets: saved }, 'PUT');
    },
    onMutate: (changes) =>
      patchCache((dashboard) => ({
        ...dashboard,
        widgets: dashboard.widgets.map((widget) => {
          const next = changes.find((entry) => entry.id === widget.id);
          return next ? { ...widget, x: next.x, y: next.y, w: next.w, h: next.h } : widget;
        }),
      })),
    onError: (error, _input, context) => {
      rollback(context);
      toastError(error, 'Could not save the layout');
    },
  });

  const addWidget = useMutation({
    mutationKey,
    mutationFn: (input: WidgetInput) => post<DashboardWidgetDto>(orgId, `/dashboards/${dashboardId}/widgets`, input),
    // The card appears at once (temporary id, live data, no actions) and is swapped for the
    // server row on success; an error removes it again.
    onMutate: async (input) => {
      pendingSeq += 1;
      const tempId = `${PENDING_PREFIX}${Date.now().toString(36)}-${pendingSeq}`;
      const temp: DashboardWidgetDto = { ...input, id: tempId, dashboardId };
      await queryClient.cancelQueries({ queryKey: key });
      const current = queryClient.getQueryData<DashboardDto>(key);
      if (current) queryClient.setQueryData<DashboardDto>(key, { ...current, widgets: [...current.widgets, temp] });
      return { tempId };
    },
    onSuccess: (widget, _input, context) => {
      const current = queryClient.getQueryData<DashboardDto>(key);
      if (current) {
        const replaced = current.widgets.some((entry) => entry.id === context?.tempId);
        queryClient.setQueryData<DashboardDto>(key, {
          ...current,
          widgets: replaced
            ? current.widgets.map((entry) => (entry.id === context?.tempId ? widget : entry))
            : [...current.widgets, widget],
        });
      }
      void settle();
    },
    onError: (error, _input, context) => {
      const current = queryClient.getQueryData<DashboardDto>(key);
      if (current && context) {
        queryClient.setQueryData<DashboardDto>(key, { ...current, widgets: current.widgets.filter((entry) => entry.id !== context.tempId) });
      }
      toastError(error, 'Could not add the widget');
    },
  });

  // Widget writes run in order per dashboard so a delete can never overtake a pending rename.
  const widgetScope = { id: `dashboard-widgets-${dashboardId}` };

  const updateWidget = useMutation({
    mutationKey,
    scope: widgetScope,
    mutationFn: (vars: { widgetId: string; input: WidgetPatch }) =>
      post<DashboardWidgetDto>(orgId, `/widgets/${vars.widgetId}`, vars.input, 'PATCH'),
    onMutate: (vars) =>
      patchCache((dashboard) => ({
        ...dashboard,
        widgets: dashboard.widgets.map((widget) => (widget.id === vars.widgetId ? { ...widget, ...vars.input } : widget)),
      })),
    onError: (error, _vars, context) => {
      rollback(context);
      toastError(error, 'Could not update the widget');
    },
  });

  const removeWidget = useMutation({
    mutationKey,
    scope: widgetScope,
    mutationFn: (vars: { widget: DashboardWidgetDto; outcome: DeleteOutcome }) =>
      apiRequest<{ id: string }>(`/widgets/${vars.widget.id}`, { orgId, method: 'DELETE' }),
    // Undo is offered the moment the card disappears, not after the round trip. Undo before the
    // DELETE lands restores the card at once and re-creates the row once the delete settles.
    onMutate: async ({ widget, outcome }) => {
      const context = await patchCache((dashboard) => ({ ...dashboard, widgets: dashboard.widgets.filter((entry) => entry.id !== widget.id) }));
      toast.undo(`“${widget.title}” deleted`, {
        onUndo: async () => {
          outcome.undone = true;
          const before = queryClient.getQueryData<DashboardDto>(key);
          if (before && !before.widgets.some((entry) => entry.id === widget.id)) {
            queryClient.setQueryData<DashboardDto>(key, { ...before, widgets: [...before.widgets, widget] });
          }
          if (!(await outcome.settled)) return; // the delete failed: the widget was never removed
          const restored = await post<DashboardWidgetDto>(orgId, `/dashboards/${dashboardId}/widgets`, {
            type: widget.type,
            title: widget.title,
            config: widget.config,
            x: widget.x,
            y: widget.y,
            w: widget.w,
            h: widget.h,
          });
          const latest = queryClient.getQueryData<DashboardDto>(key);
          if (latest) {
            queryClient.setQueryData<DashboardDto>(key, {
              ...latest,
              widgets: [...latest.widgets.filter((entry) => entry.id !== widget.id), restored],
            });
          }
          void settle();
        },
      });
      return context;
    },
    onError: (error, vars, context) => {
      vars.outcome.resolve(false);
      if (vars.outcome.undone) return;
      rollback(context);
      toastError(error, 'Could not delete the widget');
    },
    onSuccess: (_result, vars) => vars.outcome.resolve(true),
  });

  const { mutate: mutateRemove } = removeWidget;
  const deleteWidget = useCallback((widget: DashboardWidgetDto) => mutateRemove({ widget, outcome: deleteOutcome() }), [mutateRemove]);

  return { update, updateSettings, saveLayout, addWidget, updateWidget, removeWidget, deleteWidget };
}

export function useCreateDashboardFlow() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDashboardFlowInput) => post<DashboardDto>(orgId, '/dashboard-data/create', input),
    onSuccess: (dashboard) => {
      queryClient.setQueryData(queryKeys.dashboard(orgId, dashboard.id), dashboard);
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboards'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'workspaces'] });
    },
    onError: (error) => toastError(error, 'Could not create the dashboard'),
  });
}

export function useDuplicateDashboard() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { dashboardId: string; name?: string }) =>
      post<DashboardDto>(orgId, `/dashboard-data/${vars.dashboardId}/duplicate`, vars.name ? { name: vars.name } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboards'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'workspaces'] });
    },
    onError: (error) => toastError(error, 'Could not duplicate the dashboard'),
  });
}

/** Soft delete with an Undo toast that restores the dashboard. */
export function useDeleteDashboard() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'dashboards'] }),
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'workspaces'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites(orgId) }),
    ]);
  return useMutation({
    mutationFn: (dashboard: Pick<DashboardDto, 'id' | 'name'>) =>
      apiRequest<{ id: string }>(`/dashboards/${dashboard.id}`, { orgId, method: 'DELETE' }),
    onSuccess: (_result, dashboard) => {
      void refresh();
      toast.undo(`“${dashboard.name}” moved to trash`, {
        onUndo: async () => {
          await post<DashboardDto>(orgId, `/dashboard-data/${dashboard.id}/restore`, {});
          await refresh();
        },
      });
    },
    onError: (error) => toastError(error, 'Could not delete the dashboard'),
  });
}
