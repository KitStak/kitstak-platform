'use client';

/**
 * The board page: header, view tabs, toolbar, the active view's canvas and the item panel
 * (`?item=`). Everything the toolbar changes is reflected in the URL so links are shareable.
 */
import './board-toolbar.css';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Archive } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, buttonVariants, toast } from '@/components/ui';
import { BoardTable, filterItems, type OpenItemOptions } from '@/features/board-table';
import { BoardView, hasBoardViewComponent } from '@/features/board-views';
import { ImportDialog } from '@/features/import-export';
import { ItemPanelRoute, useItemPanelUrlState } from '@/features/item-panel';
import { usePrefetchItemProjects } from '@/features/item-panel/projects/api';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { ApiClientError } from '@/lib/api';
import {
  useBoard,
  useBoardLifecycle,
  useCreateGroup,
  useCreateItem,
  useRecordVisit,
  useWorkspaceTree,
  useWorkspaces,
} from '@/lib/hooks';
import type { BoardPayloadDto, ViewDto } from '@/server/services/contracts/dto';
import { BoardLoadError, BoardNoAccess, BoardPageSkeleton, CanvasSkeleton, NewItemPlaceholder } from './board-states';
import { GroupedTable } from './canvas/grouped-table';
import { ActivityDrawer } from './header/activity-drawer';
import { BoardDialogsHost, type BoardDialog } from './header/board-dialogs-host';
import { BoardHeader } from './header/board-header';
import { BoardMenu } from './header/board-menu';
import { useActiveView } from './hooks/use-active-view';
import { useBoardCommands } from './hooks/use-board-commands';
import { useBoardRealtime, type BoardLifecycleNotice } from './hooks/use-board-realtime';
import { useSearchHighlight } from './hooks/use-search-highlight';
import { useViewActions } from './hooks/use-view-actions';
import { useWorkingState } from './hooks/use-working-state';
import { ViewTabs } from './tabs/view-tabs';
import { BoardToolbar } from './toolbar/board-toolbar';

const HEADER_KEY = 'kitstak.board.header-collapsed';

const headerListeners = new Set<() => void>();
let headerMemory: boolean | null = null;

function readHeaderCollapsed(): boolean {
  if (headerMemory !== null) return headerMemory;
  try {
    return window.localStorage.getItem(HEADER_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeHeader(listener: () => void): () => void {
  headerListeners.add(listener);
  return () => headerListeners.delete(listener);
}

/** Collapsed board header (BT-006), remembered per browser. */
function useHeaderCollapsed(): readonly [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribeHeader, readHeaderCollapsed, () => false);
  const toggle = useCallback(() => {
    const next = !readHeaderCollapsed();
    headerMemory = next;
    try {
      window.localStorage.setItem(HEADER_KEY, next ? '1' : '0');
    } catch {
      // Not persisted; the in-memory value still applies for this session.
    }
    for (const listener of headerListeners) listener();
  }, []);
  return [collapsed, toggle] as const;
}

function actorName(notice: BoardLifecycleNotice | null, users: readonly { id: string; name: string }[] | undefined): string {
  if (!notice?.actorId) return 'Someone';
  return users?.find((user) => user.id === notice.actorId)?.name ?? 'Someone';
}

export function BoardPage({ boardId }: { readonly boardId: string }) {
  const board = useBoard(boardId);
  // A deep-linked record's Projects tab loads in parallel with the board, not after it.
  usePrefetchItemProjects(useItemPanelUrlState().itemId);
  const { org, user } = useOrg();
  // One realtime subscription for the page (views, lifecycle, items), whatever the view type.
  const notice = useBoardRealtime(boardId, user.id);
  if (board.isPending) return <BoardPageSkeleton />;
  if (board.isError || !board.data) {
    const status = board.error instanceof ApiClientError ? board.error.status : 0;
    if (status === 404 || status === 403) {
      return notice ? (
        <BoardNoAccess
          homeHref={routes.home(org.slug)}
          title={`${actorName(notice, board.data?.users)} deleted this board`}
          description="It's in the trash now. A board owner can restore it from the trash for 30 days."
        />
      ) : (
        <BoardNoAccess homeHref={routes.home(org.slug)} />
      );
    }
    return <BoardLoadError onRetry={() => void board.refetch()} retrying={board.isFetching} />;
  }
  return <BoardWorkspace boardId={boardId} payload={board.data} notice={notice} />;
}

function BoardWorkspace({
  boardId,
  payload,
  notice,
}: {
  readonly boardId: string;
  readonly payload: BoardPayloadDto;
  readonly notice: BoardLifecycleNotice | null;
}) {
  const { org, user } = useOrg();
  const board = payload.board;
  const noun = board.itemTerminology || 'Item';
  const { mutate: recordVisit } = useRecordVisit();
  useEffect(() => {
    recordVisit({ entityType: 'board', entityId: boardId });
  }, [boardId, recordVisit]);
  useEffect(() => {
    document.title = `${board.name} · KitStak CRM`;
  }, [board.name]);

  const viewApi = useActiveView(payload.views);
  const actions = useViewActions(boardId, viewApi.views, viewApi.active?.id ?? null, viewApi.defaultViewId, viewApi.select);
  const orderedViews = useMemo(() => {
    if (!actions.order) return viewApi.views;
    const byId = new Map(viewApi.views.map((view) => [view.id, view]));
    return actions.order.map((id) => byId.get(id)).filter((view): view is ViewDto => Boolean(view));
  }, [actions.order, viewApi.views]);
  const active = viewApi.active;

  const columns = useMemo(() => payload.columns.filter((column) => column.scope === 'item'), [payload.columns]);
  const topItems = useMemo(
    () => payload.items.filter((item) => !item.parentItemId && !item.archivedAt && !item.deletedAt),
    [payload.items],
  );
  const state = useWorkingState({
    boardId,
    view: active,
    defaultViewId: viewApi.defaultViewId,
    columns,
    canEdit: board.canEdit,
    users: payload.users,
  });
  const search = state.table.state.search;
  const usersById = useMemo(() => new Map(payload.users.map((entry) => [entry.id, entry])), [payload.users]);
  const visibleCount = useMemo(
    () =>
      filterItems(topItems, { filters: state.working.filters, search, personFilter: state.working.personFilter }, { columns, users: usersById })
        .length,
    [columns, search, state.working.filters, state.working.personFilter, topItems, usersById],
  );

  const commands = useBoardCommands(board);
  const workspaces = useWorkspaces();
  const tree = useWorkspaceTree(board.workspaceId);
  const location = useMemo(
    () => ({
      workspace: tree.data?.workspace ?? workspaces.data?.find((entry) => entry.id === board.workspaceId),
      folders: tree.data?.folders ?? [],
    }),
    [board.workspaceId, tree.data, workspaces.data],
  );

  const panel = useItemPanelUrlState();
  const openItem = useCallback((itemId: string, options?: OpenItemOptions) => panel.open(itemId, options?.tab), [panel]);
  const openItemSimple = useCallback((itemId: string) => panel.open(itemId), [panel]);

  const [headerCollapsed, toggleHeader] = useHeaderCollapsed();
  const [editingName, setEditingName] = useState(false);
  const [dialog, setDialog] = useState<BoardDialog | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const createItem = useCreateItem(boardId);
  const createGroup = useCreateGroup(boardId);
  const lifecycle = useBoardLifecycle();
  const firstGroup = useMemo(
    () => [...payload.groups].filter((group) => !group.archivedAt).sort((a, b) => (a.position < b.position ? -1 : 1))[0],
    [payload.groups],
  );

  const newItem = useCallback(() => {
    createItem.mutate(
      { name: `New ${noun.toLowerCase()}`, position: 'top', groupId: firstGroup?.id },
      {
        onSuccess: (item) => {
          panel.open(item.id);
          toast.success(`${noun} added`, firstGroup ? `At the top of “${firstGroup.title}”. Give it a name in the panel.` : undefined);
        },
      },
    );
  }, [createItem, firstGroup, noun, panel]);

  const newGroup = useCallback(() => {
    createGroup.mutate(
      { title: 'New group', ...(firstGroup ? { beforeId: firstGroup.id } : {}) },
      { onSuccess: (group) => toast.success(`Group “${group.title}” added`, 'Click its title in the table to rename it.') },
    );
  }, [createGroup, firstGroup]);

  const exportView = useCallback(
    (format: 'csv' | 'xlsx') => commands.exportAs(format, state.effectiveView?.config ?? undefined),
    [commands, state.effectiveView],
  );

  const isTable = !active || active.type === 'table';

  const canvasRef = useRef<HTMLDivElement>(null);
  useSearchHighlight(canvasRef, search);

  const automationsHref = `${routes.board(org.slug, boardId)}/automations`;
  const integrationsHref = `${automationsHref}?tab=integrations`;

  const canvas = (() => {
    if (!state.ready) return <CanvasSkeleton />;
    if (isTable) {
      if (state.groupBy && payload) {
        return (
          <GroupedTable
            boardId={boardId}
            payload={payload}
            working={state.working}
            groupBy={state.groupBy}
            search={search}
            density={state.table.state.density}
            widths={state.table.state.columnWidths}
            onOpenItem={openItem}
            onClearGroupBy={() => state.setGroupBy(null)}
          />
        );
      }
      // realtime={false}: the page owns the board's single stream (useBoardRealtime).
      return <BoardTable boardId={boardId} view={null} currentUserId={user.id} onOpenItem={openItem} realtime={false} />;
    }
    if (active && state.effectiveView && hasBoardViewComponent(active.type)) {
      return (
        <BoardView
          boardId={boardId}
          view={state.effectiveView}
          onOpenItem={openItemSimple}
          initialSettingsOpen={actions.settingsOpenFor === active.id}
          className="min-h-0 flex-1"
        />
      );
    }
    return (
      <EmptyState
        title="Dashboards open on their own page"
        actions={
          <Link href={`/${org.slug}/dashboards`} className={buttonVariants({ variant: 'primary' })}>
            Open dashboards
          </Link>
        }
      />
    );
  })();

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="board-page" data-view-type={active?.type ?? 'table'}>
      {board.archivedAt ? (
        <div role="status" className="flex items-center gap-3 border-b border-warning/40 bg-warning-subtle px-8 py-2 text-base text-warning-text max-md:px-4">
          <Archive aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1" data-testid="board-archived-banner">
            {notice ? `${actorName(notice, payload.users)} archived this board. ` : 'This board is archived. '}
            It&rsquo;s read-only until you restore it.
          </span>
          {board.canEdit ? (
            <Button size="sm" variant="secondary" loading={lifecycle.isPending} onClick={() => lifecycle.mutate({ boardId, action: 'unarchive' })}>
              Restore board
            </Button>
          ) : null}
        </div>
      ) : null}
      <BoardHeader
        orgSlug={org.slug}
        board={board}
        users={payload.users}
        totalItems={payload.totalItems}
        location={location}
        commands={commands}
        collapsed={headerCollapsed}
        editingName={editingName}
        onEditingNameChange={setEditingName}
        automationsHref={automationsHref}
        integrationsHref={integrationsHref}
        onShare={() => setDialog('share')}
        onActivity={() => setActivityOpen(true)}
        onSettings={() => setDialog('settings')}
        menu={
          <BoardMenu
            board={board}
            commands={commands}
            automationsHref={automationsHref}
            integrationsHref={integrationsHref}
            headerCollapsed={headerCollapsed}
            onToggleHeader={toggleHeader}
            onRename={() => setEditingName(true)}
            onDuplicate={() => setDialog('duplicate')}
            onMove={() => setDialog('move')}
            onShare={() => setDialog('share')}
            onSettings={() => setDialog('settings')}
            onActivity={() => setActivityOpen(true)}
            onImport={() => setImportOpen(true)}
            onDelete={() => setConfirmDelete(true)}
            onExport={exportView}
          />
        }
      />
      <ViewTabs
        views={orderedViews}
        activeId={active?.id ?? null}
        canEdit={board.canEdit}
        onSelect={viewApi.select}
        onAdd={actions.add}
        adding={actions.adding}
        renamingId={actions.renamingId}
        onRenamingChange={actions.setRenamingId}
        onRename={actions.rename}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
        onSetDefault={actions.setDefault}
        onCopyLink={actions.copyLink}
        onReorder={actions.reorder}
      />
      {active?.type === 'form' ? null : (
        <BoardToolbar
          viewType={active?.type ?? 'table'}
          noun={noun}
          canEdit={board.canEdit && !board.archivedAt}
          columns={columns}
          users={payload.users}
          items={topItems}
          visibleCount={visibleCount}
          state={state}
          canSave={board.canEdit && Boolean(active)}
          creating={createItem.isPending}
          headerCollapsed={headerCollapsed}
          onToggleHeader={toggleHeader}
          onNewItem={newItem}
          onNewGroup={newGroup}
          onImport={() => setImportOpen(true)}
          onExport={exportView}
        />
      )}
      <div ref={canvasRef} key={active?.id ?? 'table'} className="flex min-h-0 flex-1 flex-col animate-fade-in" data-testid="board-canvas">
        {canvas}
      </div>

      <ItemPanelRoute boardId={boardId} />
      {createItem.isPending && !panel.itemId ? <NewItemPlaceholder noun={noun} /> : null}
      <ActivityDrawer
        open={activityOpen}
        onOpenChange={setActivityOpen}
        boardId={boardId}
        columns={payload.columns}
        items={payload.items}
        users={payload.users}
        onOpenItem={(itemId) => {
          setActivityOpen(false);
          panel.open(itemId);
        }}
      />
      <BoardDialogsHost
        dialog={dialog}
        onClose={() => setDialog(null)}
        board={board}
        users={payload.users}
        commands={commands}
        views={viewApi.views}
        columns={columns}
        onSetDefaultView={(viewId) => {
          const view = viewApi.views.find((entry) => entry.id === viewId);
          if (view) actions.setDefault(view);
        }}
      />
      <ImportDialog boardId={boardId} open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Delete “${board.name}”?`}
        description={`The board and its ${payload.totalItems.toLocaleString('en-US')} ${noun.toLowerCase()}s move to the trash. You can undo this right after, or restore it from the trash for 30 days.`}
        confirmLabel="Delete board"
        loading={commands.removing}
        onConfirm={() => {
          setConfirmDelete(false);
          commands.remove();
        }}
      />
    </div>
  );
}
