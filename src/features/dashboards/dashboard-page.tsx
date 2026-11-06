'use client';

/** Dashboard page container: data, URL filter state, dialogs and the widget grid. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Plus } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, cn, toast } from '@/components/ui';
import { useDashboard, useFavorites, useOrgId, useRecordVisit, useToggleFavorite, useWorkspaces } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import type { DashboardWidgetDto } from '@/server/services/contracts/dto';
import { widgetTypeForKind, type DashboardSettings, type WidgetKind } from '@/server/services/contracts/dashboard-insights';
import { AddWidgetDialog, type NewWidget } from './components/add-widget-dialog';
import { DashboardGrid, type GridSlotProps } from './components/dashboard-grid';
import { DashboardHeader } from './components/dashboard-header';
import { DashboardSkeleton } from './components/dashboard-skeleton';
import { DashboardToolbar } from './components/dashboard-toolbar';
import { PresentMode, enterFullscreen } from './components/present-mode';
import { ShareDialog } from './components/share-dialog';
import { WidgetCard, type WidgetActions } from './components/widget-card';
import { WidgetFullscreen } from './components/widget-fullscreen';
import { WidgetSettingsPanel } from './components/widget-settings-panel';
import { isPendingWidgetId, seedWidgetInsight, useDashboardActions, useDashboardSources, useDeleteDashboard, useDuplicateDashboard, useRefreshWidgets } from './hooks';
import { defaultWidget, presetSize, widgetDefinition } from './lib/catalog';
import {
  EMPTY_FILTERS,
  describeRange,
  isFiltered,
  parseFilterParams,
  toInsightFilters,
  writeFilterParams,
  type DashboardFilterState,
} from './lib/filters';
import { changedItems, firstFreeSlot, tidyLayout, type GridItem } from './lib/layout';
import { DashboardFilterContext, type DashboardFilterHint } from './widgets/filter-context';
import { useDashboardRealtime } from './use-dashboard-realtime';
import './dashboards.css';

/** Focus a widget's settings button (or its card) after a panel/dialog closes. */
function focusWidget(widgetId: string | null): boolean {
  if (!widgetId) return false;
  const card = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);
  const target = card?.querySelector<HTMLElement>('[aria-label="Widget settings"]') ?? card?.querySelector<HTMLElement>('header[tabindex]') ?? card;
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]') !== null;
}

export function DashboardPage({ dashboardId }: { readonly dashboardId: string }) {
  const { org, user, permissions } = useOrg();
  const orgId = useOrgId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const dashboard = useDashboard(dashboardId);
  const sources = useDashboardSources();
  const workspaces = useWorkspaces();
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const recordVisit = useRecordVisit();
  const actions = useDashboardActions(dashboardId);
  const duplicateDashboard = useDuplicateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const refreshWidgets = useRefreshWidgets();
  const canEdit = permissions.includes('dashboard:write');

  // Filters and present mode live in React state (instant) and are mirrored to the URL so a
  // filtered view can be shared or reloaded.
  const [filterState, setFilterState] = useState(() => parseFilterParams(new URLSearchParams(searchParams.toString())));
  const [presenting, setPresentingState] = useState(() => searchParams.get('present') === '1');
  const filters = useMemo(() => toInsightFilters(filterState), [filterState]);
  const writeUrl = useCallback(
    (state: DashboardFilterState, present: boolean) => {
      const params = writeFilterParams(state, new URLSearchParams(window.location.search));
      params.delete('add');
      if (present) params.set('present', '1');
      else params.delete('present');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${pathname}${query ? `?${query}` : ''}`);
    },
    [pathname],
  );
  const setFilters = useCallback(
    (next: DashboardFilterState) => {
      setFilterState(next);
      writeUrl(next, presenting);
    },
    [writeUrl, presenting],
  );

  const [addOpen, setAddOpen] = useState(() => searchParams.get('add') === '1' && canEdit);
  const [addKind, setAddKind] = useState<WidgetKind | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const addTrigger = useRef<HTMLElement | null>(null);
  const lastSettingsId = useRef<string | null>(null);
  const layoutUndo = useRef<GridItem[] | null>(null);
  const duplicating = useRef(new Set<string>());
  // The sticky filter bar gets its divider only once the page has scrolled under it.
  const [scrolled, setScrolled] = useState(false);

  const setPresenting = useCallback(
    (value: boolean) => {
      // Requested here, inside the click / key handler, so the browser treats it as a gesture.
      if (value) enterFullscreen();
      if (value) setSettingsId(null);
      setPresentingState(value);
      writeUrl(filterState, value);
    },
    [writeUrl, filterState],
  );
  const exitPresent = useCallback(() => setPresenting(false), [setPresenting]);
  const openAdd = useCallback((kind: WidgetKind | null) => {
    addTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsId(null);
    setAddKind(kind);
    setAddOpen(true);
  }, []);
  const closeSettings = useCallback(() => setSettingsId(null), []);

  const visited = useRef(false);
  useEffect(() => {
    if (visited.current || !dashboard.data) return;
    visited.current = true;
    recordVisit.mutate({ entityType: 'dashboard', entityId: dashboardId });
  }, [dashboard.data, dashboardId, recordVisit]);

  useEffect(() => {
    if (!highlightId) return;
    const node = document.querySelector(`[data-widget-id="${highlightId}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const id = window.setTimeout(() => setHighlightId(null), 1200);
    return () => window.clearTimeout(id);
  }, [highlightId, dashboard.data]);

  const config = (dashboard.data?.config ?? {}) as DashboardSettings & { boardIds?: string[] };
  const settings = {
    privacy: config.privacy ?? 'main',
    autoRefreshSec: config.autoRefreshSec ?? 0,
    lockLayout: config.lockLayout ?? false,
  } as const;
  const connected = useMemo(() => (Array.isArray(config.boardIds) ? config.boardIds.filter((id): id is string => typeof id === 'string') : []), [config.boardIds]);
  const widgets = useMemo(() => dashboard.data?.widgets ?? [], [dashboard.data?.widgets]);
  // Live updates: the dashboard's own boards plus any board a widget reads from.
  const streamBoardIds = useMemo(() => {
    const ids = new Set(connected);
    for (const widget of widgets) {
      const own = (widget.config as { boardIds?: unknown }).boardIds;
      if (Array.isArray(own)) for (const id of own) if (typeof id === 'string') ids.add(id);
    }
    return [...ids];
  }, [connected, widgets]);
  const peopleById = useMemo(() => new Map((sources.data?.users ?? []).map((person) => [person.id, person.name])), [sources.data?.users]);
  const remoteChanges = useDashboardRealtime({
    orgId,
    dashboardId,
    userId: user.id,
    boardIds: streamBoardIds,
    nameOf: (id) => (id ? (peopleById.get(id) ?? 'a teammate') : 'an automation'),
  });
  const refetchInterval = presenting ? Math.max(settings.autoRefreshSec, 60) * 1000 : settings.autoRefreshSec > 0 ? settings.autoRefreshSec * 1000 : false;
  const fetchingWidgets = useIsFetching({ queryKey: ['org', orgId, 'widget'] });
  const widgetQueries = queryClient.getQueryCache().findAll({ queryKey: ['org', orgId, 'widget'], type: 'active' });
  const lastUpdated = widgetQueries.reduce((latest, query) => Math.max(latest, query.state.dataUpdatedAt), 0);
  const failedCount = widgetQueries.filter((query) => query.state.status === 'error').length;
  const refreshAll = useCallback(async () => {
    await refreshWidgets();
    const failed = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['org', orgId, 'widget'], type: 'active' })
      .filter((query) => query.state.status === 'error').length;
    if (failed > 0) {
      toast.error("Couldn't refresh every widget", `${failed} widget${failed === 1 ? '' : 's'} still show older data. Try again in a moment.`);
    }
  }, [orgId, queryClient, refreshWidgets]);

  // Layout saves with an Undo toast; Ctrl/Cmd+Z restores the last layout change.
  const saveLayout = actions.saveLayout;
  const applyLayout = useCallback(
    (changes: GridItem[], options: { undoable: boolean; message?: string }) => {
      const before = widgets.filter((widget) => changes.some((change) => change.id === widget.id)).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
      saveLayout.mutate(changes);
      if (!options.undoable) return;
      layoutUndo.current = before;
      toast.undo(options.message ?? 'Layout updated', {
        duration: 6000,
        onUndo: async () => {
          layoutUndo.current = null;
          await saveLayout.mutateAsync(before);
        },
      });
    },
    [saveLayout, widgets],
  );
  const commitLayout = useCallback((changes: GridItem[]) => applyLayout(changes, { undoable: true }), [applyLayout]);
  const tidy = useCallback(() => {
    const current = widgets.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    const changes = changedItems(current, tidyLayout(current));
    if (changes.length === 0) {
      toast.success('Layout is already tidy');
      return;
    }
    applyLayout(changes, { undoable: true, message: 'Layout tidied up' });
  }, [applyLayout, widgets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && layoutUndo.current) {
        event.preventDefault();
        const previous = layoutUndo.current;
        layoutUndo.current = null;
        saveLayout.mutate(previous);
        toast.success('Layout change undone');
        return;
      }
      if (event.key !== 'p' || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setPresenting(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPresenting, saveLayout]);

  // Widget actions are stable for the page's lifetime (they read the latest state through a
  // ref), so memoised widget cards do not re-render when unrelated state changes.
  const latest = useRef({ widgets, settingsId, actions });
  useEffect(() => {
    latest.current = { widgets, settingsId, actions };
  });
  const widgetActions: WidgetActions = useMemo(
    () => ({
      onOpenSettings: (widget) => {
        lastSettingsId.current = widget.id;
        setSettingsId(widget.id);
      },
      onFullscreen: (widget) => {
        setSettingsId(null);
        setFullscreenId(widget.id);
      },
      onDuplicate: (stale) => {
        // One copy per click: ignore repeats while that widget's copy is still being saved.
        if (duplicating.current.has(stale.id)) return;
        // Cards skip re-rendering on moves, so resolve the widget's current geometry by id.
        const widget = latest.current.widgets.find((entry) => entry.id === stale.id) ?? stale;
        const slot = firstFreeSlot(latest.current.widgets, widget.w, widget.h);
        duplicating.current.add(widget.id);
        latest.current.actions.addWidget.mutate(
          { type: widget.type, title: `${widget.title} (copy)`, config: widget.config, x: slot.x, y: slot.y, w: widget.w, h: widget.h },
          {
            onSuccess: (created) => {
              setHighlightId(created.id);
              toast.success('Widget duplicated');
            },
            onSettled: () => duplicating.current.delete(widget.id),
          },
        );
      },
      onDelete: (stale) => {
        const widget = latest.current.widgets.find((entry) => entry.id === stale.id) ?? stale;
        if (latest.current.settingsId === widget.id) setSettingsId(null);
        latest.current.actions.deleteWidget(widget);
      },
      onRename: (widget, title) => latest.current.actions.updateWidget.mutate({ widgetId: widget.id, input: { title } }),
      onUpdateConfig: (widget, nextConfig) => latest.current.actions.updateWidget.mutate({ widgetId: widget.id, input: { config: nextConfig } }),
    }),
    [],
  );

  const filtered = isFiltered(filterState);
  const filterHint = useMemo<DashboardFilterHint>(
    () => ({
      search: filterState.search.trim(),
      hasPeople: filterState.personIds.length > 0,
      hasRange: filterState.range !== 'all',
      rangeLabel: describeRange(filterState),
      from: filters.from,
      to: filters.to,
      onClearSearch: () => setFilters({ ...filterState, search: '' }),
      onClearAll: () => setFilters(EMPTY_FILTERS),
    }),
    [filterState, filters.from, filters.to, setFilters],
  );

  const renderWidget = useCallback(
    (widget: DashboardWidgetDto, slot: GridSlotProps) => (
      <WidgetCard
        dashboardId={dashboardId}
        widget={widget}
        filters={filters}
        filtered={filtered}
        orgSlug={org.slug}
        editable={canEdit}
        refetchInterval={refetchInterval}
        highlighted={highlightId === widget.id || remoteChanges.has(widget.id)}
        updatedBy={remoteChanges.get(widget.id)}
        pending={isPendingWidgetId(widget.id)}
        editing={settingsId === widget.id}
        dragging={slot.dragging}
        handleProps={slot.handleProps}
        onResizeStart={slot.onResizeStart}
        actions={widgetActions}
      />
    ),
    [canEdit, dashboardId, filtered, filters, highlightId, org.slug, refetchInterval, remoteChanges, settingsId, widgetActions],
  );

  if (dashboard.isPending) return <DashboardSkeleton />;
  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          illustration="error"
          title="This dashboard couldn't be opened"
          description="It may have been deleted, made private, or you may not have access to its workspace."
          actions={
            <>
              <Button variant="secondary" onClick={() => void dashboard.refetch()}>
                Try again
              </Button>
              <Link href={`/${org.slug}/dashboards`} className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                All dashboards
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const data = dashboard.data;
  const isFavorite = (favorites.data ?? []).some((entry) => entry.entityType === 'dashboard' && entry.entityId === dashboardId);
  const users = sources.data?.users ?? [];
  const workspaceName = workspaces.data?.find((workspace) => workspace.id === data.workspaceId)?.name ?? null;
  const settingsWidget = widgets.find((widget) => widget.id === settingsId) ?? null;
  const fullscreenWidget = widgets.find((widget) => widget.id === fullscreenId) ?? null;
  const canMove = canEdit && !settings.lockLayout;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const baseUrl = `${origin}/${org.slug}/dashboards/${dashboardId}`;
  const filterQuery = writeFilterParams(filterState, new URLSearchParams()).toString();
  const filteredUrl = filterQuery ? `${baseUrl}?${filterQuery}` : baseUrl;
  const saveSettings = (next: DashboardSettings) => actions.updateSettings.mutate(next);

  const placeWidget = (input: NewWidget, after?: () => void) => {
    const definition = widgetDefinition(input.kind);
    const size = definition.chromeless ? definition.size : presetSize(input.kind, input.size);
    const slot = firstFreeSlot(widgets, size.w, size.h);
    actions.addWidget.mutate(
      { type: widgetTypeForKind(input.kind), title: input.title.trim() || definition.label, config: { ...input.config, kind: input.kind }, ...slot, ...size },
      {
        onSuccess: (widget) => {
          // The preview already computed this widget's data: show it immediately.
          if (input.preview) seedWidgetInsight(queryClient, orgId, widget, filters, input.preview);
          after?.();
          setHighlightId(widget.id);
          if (definition.needsBoards && connected.length === 0 && !(input.config.boardIds as string[] | undefined)?.length) setSettingsId(widget.id);
        },
      },
    );
  };

  return (
    <DashboardFilterContext.Provider value={filterHint}>
      <div
        className={cn(
          'h-full overflow-y-auto bg-sunken transition-[padding] duration-[var(--duration-normal)] ease-out motion-reduce:transition-none',
          // Reserve the settings panel's width on wide screens so the header, toolbar and
          // widgets under it stay reachable.
          settingsWidget && 'lg:pr-[392px]',
        )}
        data-testid="dashboard-page"
        onScroll={(event) => {
          const next = event.currentTarget.scrollTop > 4;
          if (next !== scrolled) setScrolled(next);
        }}
        data-settings-open={settingsWidget ? 'true' : undefined}
      >
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
          <DashboardHeader
            dashboard={data}
            canEdit={canEdit}
            favorite={isFavorite}
            viewers={settings.privacy === 'private' ? users.filter((person) => person.id === (data.createdBy ?? user.id)) : users}
            settings={settings}
            onRename={(name) => actions.update.mutate({ name })}
            onDescribe={(description) => actions.update.mutate({ description })}
            onToggleFavorite={() => toggleFavorite.mutate({ entityType: 'dashboard', entityId: dashboardId, favorite: !isFavorite, name: data.name })}
            onShare={() => {
              setSettingsId(null);
              setShareOpen(true);
            }}
            onDuplicate={() =>
              duplicateDashboard.mutate(
                { dashboardId },
                {
                  onSuccess: (copy) => {
                    toast.success('Dashboard duplicated', copy.name);
                    router.push(`/${org.slug}/dashboards/${copy.id}`);
                  },
                },
              )
            }
            onPresent={() => setPresenting(true)}
            onDelete={() => {
              setSettingsId(null);
              setConfirmDelete(true);
            }}
            onCopyLink={() => {
              void navigator.clipboard.writeText(filteredUrl).then(
                () => toast.success('Link copied', filtered ? 'The link keeps your current filters.' : undefined),
                () => toast.error("Couldn't copy the link"),
              );
            }}
            onSettings={saveSettings}
            onTidy={canMove && widgets.length > 1 ? tidy : undefined}
          />
          <div
            className={cn(
              'sticky top-0 z-[var(--z-sticky)] -mx-4 border-b bg-sunken px-4 py-2 transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-out sm:-mx-6 sm:px-6',
              scrolled ? 'border-border-subtle shadow-[var(--elevation-sticky)]' : 'border-transparent',
            )}
            data-scrolled={scrolled || undefined}
          >
            <DashboardToolbar
              canEdit={canEdit}
              locked={settings.lockLayout}
              boards={sources.data?.boards ?? []}
              connected={connected}
              autoInclude={config.autoIncludeBoards ?? true}
              users={users}
              filters={filterState}
              refreshing={fetchingWidgets > 0}
              lastUpdated={lastUpdated}
              failedCount={failedCount}
              onAddWidget={openAdd}
              onBoardsChange={(boardIds) => actions.update.mutate({ boardIds })}
              onAutoIncludeChange={(value) => saveSettings({ autoIncludeBoards: value })}
              onFiltersChange={setFilters}
              onRefresh={() => void refreshAll()}
              onPresent={() => setPresenting(true)}
              onUnlock={() => saveSettings({ lockLayout: false })}
            />
          </div>
          {widgets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-panel">
              <EmptyState
                visual={
                  <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-subtle text-primary-text">
                    <LayoutDashboard aria-hidden className="size-8" />
                  </span>
                }
                title="Your dashboard is ready for widgets"
                description={connected.length === 0 ? 'Connect a board, then add KPIs, charts, a forecast or a team leaderboard.' : 'Add KPIs, charts, a forecast or a team leaderboard. Each one updates live as your boards change.'}
                actions={
                  canEdit ? (
                    <>
                      <Button leadingIcon={<Plus />} onClick={() => openAdd(null)}>
                        Add widget
                      </Button>
                      {connected.length > 0 ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const boards = (sources.data?.boards ?? []).filter((board) => connected.includes(board.id));
                            const numbers = defaultWidget('numbers', boards);
                            placeWidget({ kind: 'numbers', title: numbers.title, config: numbers.config });
                          }}
                        >
                          Quick start with a KPI
                        </Button>
                      ) : null}
                    </>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <DashboardGrid widgets={widgets} canMove={canMove} onCommit={commitLayout} renderWidget={renderWidget} />
          )}
        </div>

        <AddWidgetDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          dashboardId={dashboardId}
          initialKind={addKind}
          sources={sources.data}
          dashboardBoardIds={connected}
          filters={filters}
          orgSlug={org.slug}
          adding={actions.addWidget.isPending}
          onAdd={(input) => placeWidget(input, () => setAddOpen(false))}
          onCloseAutoFocus={(event) => {
            // The split button / quick-add menu item that opened the dialog may be gone.
            event.preventDefault();
            const trigger = addTrigger.current;
            const fallback = document.querySelector<HTMLElement>('[data-testid="add-widget"]')?.closest('button');
            (trigger?.isConnected ? trigger : fallback)?.focus({ preventScroll: true });
          }}
        />
        <WidgetSettingsPanel
          dashboardId={dashboardId}
          widget={settingsWidget}
          sources={sources.data}
          dashboardBoardIds={connected}
          filters={filters}
          onClose={closeSettings}
          onSave={(widget, patch) => actions.updateWidget.mutate({ widgetId: widget.id, input: patch })}
          onCloseAutoFocus={(event) => {
            if (focusWidget(lastSettingsId.current)) event.preventDefault();
          }}
        />
        <WidgetFullscreen
          widget={fullscreenWidget}
          onClose={() => setFullscreenId(null)}
          dashboardId={dashboardId}
          filters={filters}
          filtered={filtered}
          orgSlug={org.slug}
          actions={widgetActions}
        />
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          baseUrl={baseUrl}
          filteredUrl={filteredUrl}
          hasFilters={filtered}
          privacy={settings.privacy}
          canEdit={canEdit}
          ownerId={data.createdBy}
          people={users}
          workspaceName={workspaceName}
          onPrivacyChange={(privacy) => saveSettings({ privacy })}
        />
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete “${data.name}”?`}
          description="The dashboard and its widgets move to trash. Boards and their data are not affected."
          confirmLabel="Delete dashboard"
          destructive
          loading={deleteDashboard.isPending}
          onConfirm={() => {
            // Leave first so this page's queries never refetch a deleted dashboard (404s);
            // the list shows the Undo toast once the delete lands.
            setConfirmDelete(false);
            router.push(`/${org.slug}/dashboards`);
            deleteDashboard.mutate(data);
          }}
        />
        {presenting ? (
          <PresentMode dashboard={data} filters={filters} orgSlug={org.slug} refetchInterval={refetchInterval} actions={widgetActions} onExit={exitPresent} />
        ) : null}
      </div>
    </DashboardFilterContext.Provider>
  );
}
