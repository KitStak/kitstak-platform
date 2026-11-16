'use client';
/** Workspace overview "Content" tab: search, type filter, sort and a list with row menus. */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, Plus, Share2, Upload, X } from 'lucide-react';
import { Button, EmptyState, SearchInput, Select, ToggleGroup, cn } from '@/components/ui';
import { formatRelativeTime } from '@/features/home/format';
import type { WorkspaceTreeDto } from '../api';
import { BOARD_KIND_META, EntityIcon } from '../entity-icon';
import { FolderGlyph } from '../folder-icon';
import { useCan, useOrg } from '../org-context';
import { routes } from '../routes';
import { useShellStore } from '../store';
import { useTreeActions } from '../sidebar/tree-actions';
import { BoardMenu, DashboardMenu, FolderMenu } from '../sidebar/tree-menus';
import {
  contentRows,
  filterAndSort,
  type ContentRow,
  type ContentSort,
  type ContentType,
} from './workspace-content-model';
import type { WorkspaceUrlState } from './workspace-url-model';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'board', label: 'Boards' },
  { value: 'dashboard', label: 'Dashboards' },
  { value: 'folder', label: 'Folders' },
] as const;

const SORT_OPTIONS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name (A to Z)' },
  { value: 'type', label: 'Type' },
];

const ROW = 'grid grid-cols-[minmax(0,1fr)_32px] items-center gap-4 px-4 md:grid-cols-[minmax(0,1fr)_120px_160px_120px_32px]';

function RowName({
  row,
  href,
  onOpenFolder,
}: {
  readonly row: ContentRow;
  readonly href: string | null;
  readonly onOpenFolder: (folderId: string) => void;
}) {
  const icon =
    row.type === 'folder' ? (
      <FolderGlyph folderId={row.folder.id} color={row.folder.color} className="size-[18px]" />
    ) : row.type === 'board' ? (
      <EntityIcon type="board" boardKind={row.board.kind} className="size-[18px]" />
    ) : (
      <EntityIcon type="dashboard" className="size-[18px]" />
    );
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-fg group-hover/link:text-primary-text" title={row.name}>
          {row.name}
        </span>
        {row.type === 'board' && row.board.description ? (
          <span className="truncate text-xs text-fg-muted">{row.board.description}</span>
        ) : row.type === 'folder' ? (
          <span className="text-xs text-fg-muted">
            {row.childCount} {row.childCount === 1 ? 'item' : 'items'}
          </span>
        ) : null}
      </span>
      {row.type === 'board' && row.board.privacy === 'private' ? <Lock aria-label="Private board" className="size-3.5 shrink-0 text-icon" /> : null}
      {row.type === 'board' && row.board.privacy === 'shareable' ? <Share2 aria-label="Shareable board" className="size-3.5 shrink-0 text-icon" /> : null}
    </>
  );
  if (!href) {
    return (
      <button
        type="button"
        onClick={() => onOpenFolder(row.id)}
        className="group/link flex min-w-0 items-center gap-3 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      href={href}
      className="group/link flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {content}
    </Link>
  );
}

export interface WorkspaceContentTabProps {
  readonly tree: WorkspaceTreeDto;
  readonly view: WorkspaceUrlState;
  readonly onViewChange: (patch: Partial<WorkspaceUrlState>) => void;
}

export function WorkspaceContentTab({ tree, view, onViewChange }: WorkspaceContentTabProps) {
  const { org } = useOrg();
  const actions = useTreeActions(org.id, tree.workspace.id);
  const requestCreate = useShellStore((state) => state.requestCreate);
  const canCreate = useCan('board:create');
  const { q: query, type, sort } = view;
  const setQuery = (q: string) => onViewChange({ q });
  const setType = (next: ContentType) => onViewChange({ type: next });
  const setSort = (next: ContentSort) => onViewChange({ sort: next });
  const folder = view.folder ? (tree.folders.find((entry) => entry.id === view.folder) ?? null) : null;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const all = useMemo(() => contentRows(tree), [tree]);
  const rows = useMemo(
    () => filterAndSort(all, { type, query, sort, folderId: folder?.id ?? null }),
    [all, type, query, sort, folder?.id],
  );
  const filtered = Boolean(query.trim()) || type !== 'all' || folder !== null;
  const clearFilters = () => onViewChange({ q: '', type: 'all', folder: null });

  if (all.length === 0) {
    return (
      <EmptyState
        illustration="workspace"
        title="Start by adding a board"
        actions={
          canCreate ? (
            <>
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => requestCreate({ kind: 'board', workspaceId: tree.workspace.id })}>
                New board
              </Button>
              <Button variant="secondary" onClick={() => requestCreate({ kind: 'board', workspaceId: tree.workspace.id, mode: 'templates' })}>
                Choose a template
              </Button>
              <Button variant="ghost" leadingIcon={<Upload aria-hidden />} onClick={() => window.location.assign(routes.importData(org.slug))}>
                Import
              </Button>
            </>
          ) : null
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="workspace-content">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search this workspace"
            aria-label="Search this workspace"
            size="sm"
          />
        </div>
        <ToggleGroup label="Filter by type" value={type} onValueChange={setType} options={TYPE_OPTIONS} size="sm" />
        {folder ? (
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-default bg-sunken pr-1 pl-2.5 text-sm text-fg"
            data-testid="workspace-folder-filter"
          >
            <FolderGlyph folderId={folder.id} open color={folder.color} className="size-3.5" />
            <span className="max-w-40 truncate" title={folder.name}>
              {folder.name}
            </span>
            <button
              type="button"
              aria-label={`Show all content, not only ${folder.name}`}
              onClick={() => onViewChange({ folder: null })}
              className="inline-flex size-5 items-center justify-center rounded-full text-icon transition-colors hover:bg-pressed hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-fg-muted sm:inline">Sort</span>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as ContentSort)}
            options={SORT_OPTIONS}
            size="sm"
            aria-label="Sort content"
            className="w-40"
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
        <div className={cn(ROW, 'hidden h-9 border-b border-border-subtle bg-sunken text-xs font-semibold text-fg-muted md:grid')}>
          <span>Name</span>
          <span>Type</span>
          <span>Folder</span>
          <span>Last updated</span>
          <span className="sr-only">Actions</span>
        </div>
        {rows.length === 0 ? (
          <div data-testid="workspace-content-empty">
            <EmptyState
              size="sm"
              illustration="search"
              title={query.trim() ? `Nothing matches “${query.trim()}”` : folder ? `“${folder.name}” is empty` : 'Nothing here yet'}
              description={filtered ? 'Try another word, or clear the filters to see everything in this workspace.' : undefined}
              actions={
                filtered ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => {
              const href =
                row.type === 'board'
                  ? routes.board(org.slug, row.id)
                  : row.type === 'dashboard'
                    ? routes.dashboard(org.slug, row.id)
                    : null;
              const typeLabel =
                row.type === 'board' ? BOARD_KIND_META[row.board.kind].label : row.type === 'dashboard' ? 'Dashboard' : 'Folder';
              return (
                <li key={`${row.type}:${row.id}`} className={cn(ROW, 'group h-14 transition-colors hover:bg-hover')} data-testid="workspace-content-row">
                  {renamingId === row.id ? (
                    <input
                      autoFocus
                      aria-label="Name"
                      defaultValue={row.name}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={(event) => {
                        setRenamingId(null);
                        const next = event.currentTarget.value.trim();
                        if (!next || next === row.name) return;
                        if (row.type === 'board') void actions.renameBoard(row.id, next);
                        else if (row.type === 'folder') void actions.renameFolder(row.id, next);
                        else void actions.renameDashboard(row.id, next);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          event.currentTarget.value = row.name;
                          event.currentTarget.blur();
                        }
                      }}
                      className="h-8 rounded-sm border border-primary bg-panel px-2 text-base outline-none shadow-[0_0_0_3px_var(--focus-ring-soft)]"
                    />
                  ) : (
                    <RowName row={row} href={href} onOpenFolder={(folderId) => onViewChange({ folder: folderId, type: 'all' })} />
                  )}
                  <span className="hidden truncate text-sm text-fg-secondary md:block">{typeLabel}</span>
                  <span className="hidden truncate text-sm text-fg-secondary md:block">{row.folderName ?? 'None'}</span>
                  <span className="hidden text-sm text-fg-muted tabular-nums md:block">
                    {row.updatedAt ? formatRelativeTime(row.updatedAt) : 'None'}
                  </span>
                  <span className="flex justify-end opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[data-state=open]]:opacity-100">
                    {row.type === 'board' ? (
                      <BoardMenu board={row.board} href={href ?? ''} folders={tree.folders} actions={actions} onRename={() => setRenamingId(row.id)} />
                    ) : row.type === 'folder' ? (
                      <FolderMenu folder={row.folder} folders={tree.folders} actions={actions} onRename={() => setRenamingId(row.id)} />
                    ) : (
                      <DashboardMenu id={row.id} name={row.name} href={href ?? ''} actions={actions} onRename={() => setRenamingId(row.id)} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
