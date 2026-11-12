'use client';
/**
 * "…" menus for sidebar tree rows (board, folder, dashboard). Order follows SH-030:
 * Open in new tab · Rename · Favorites · Duplicate ▸ · Move to ▸ · Copy link · Archive · Delete.
 */
import { useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Copy,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Link2,
  ListCollapse,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Search,
  Shapes,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import {
  ColorPicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  LABEL_COLOR_NAMES,
  cn,
  toLabelColor,
  toast,
} from '@/components/ui';
import { FOLDER_ICONS } from '@/server/services/shell-folders-model';
import {
  useFavorites,
  useFolderIcons,
  useToggleFavorite,
  useWorkspaces,
  type BoardSummaryDto,
  type FolderDto,
  type WorkspaceDto,
} from '../api';
import { FOLDER_ICON_META, FolderGlyph } from '../folder-icon';
import { pluralize } from '@/features/home/format';
import { useCan, useOrg } from '../org-context';
import { useShellStore } from '../store';
import { WorkspaceTile } from './workspace-switcher';
import type { TreeActions } from './tree-actions';

export function RowMenuTrigger({ label }: { readonly label: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        data-testid="tree-row-menu"
        className="inline-flex size-6 items-center justify-center rounded-xs text-icon transition-colors hover:bg-pressed hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-pressed data-[state=open]:text-icon-strong"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
    </DropdownMenuTrigger>
  );
}

export async function copyLink(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
    toast.success('Link copied');
  } catch {
    toast.error("Couldn't copy the link", 'Your browser blocked clipboard access.');
  }
}

function FavoriteItem({
  entityType,
  entityId,
  name,
  boardKind,
}: {
  readonly entityType: 'board' | 'dashboard' | 'folder';
  readonly entityId: string;
  readonly name: string;
  readonly boardKind?: BoardSummaryDto['kind'] | null;
}) {
  const { org } = useOrg();
  const favorites = useFavorites(org.id);
  const toggle = useToggleFavorite(org.id);
  const favorite = favorites.data?.find((entry) => entry.entityId === entityId);
  return (
    <DropdownMenuItem
      icon={favorite ? <StarOff aria-hidden /> : <Star aria-hidden />}
      onSelect={() =>
        toggle.mutate(
          { entityType, entityId, favoriteId: favorite?.id, name, boardKind },
          {
            onSuccess: () => toast.success(favorite ? 'Removed from favorites' : 'Added to favorites'),
            onError: () => toast.error(favorite ? "Couldn't remove from favorites" : "Couldn't add to favorites"),
          },
        )
      }
    >
      {favorite ? 'Remove from favorites' : 'Add to favorites'}
    </DropdownMenuItem>
  );
}

const MOVE_SEARCH_MIN = 6;
const MOVE_KEYS_PASSED_TO_MENU = ['ArrowDown', 'ArrowUp', 'Escape', 'Tab'];

/**
 * "Move to" submenu body: a typeahead filter (shown once there are enough targets) above a
 * height-capped, scrollable list of folders in this workspace and other workspaces.
 */
function MoveTargets({
  rootLabel,
  rootDisabled,
  onRoot,
  folders,
  isFolderDisabled,
  onFolder,
  workspaces,
  onWorkspace,
}: {
  readonly rootLabel: string;
  readonly rootDisabled: boolean;
  readonly onRoot: () => void;
  readonly folders: readonly FolderDto[];
  readonly isFolderDisabled: (folder: FolderDto) => boolean;
  readonly onFolder: (folder: FolderDto) => void;
  readonly workspaces: readonly WorkspaceDto[];
  readonly onWorkspace: (workspace: WorkspaceDto) => void;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const showSearch = folders.length + workspaces.length >= MOVE_SEARCH_MIN;
  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const shownFolders = folders.filter((folder) => matches(folder.name));
  const shownWorkspaces = workspaces.filter((workspace) => matches(workspace.name));
  const rootShown = matches(rootLabel);
  const nothing = !rootShown && shownFolders.length === 0 && shownWorkspaces.length === 0;
  return (
    <>
      {showSearch ? (
        <div className="sticky top-0 z-[1] -mx-1 -mt-1 mb-1 border-b border-border-subtle bg-raised p-1.5">
          <label className="flex h-8 items-center gap-2 rounded-sm border border-border-input bg-panel px-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)]">
            <Search aria-hidden className="size-3.5 shrink-0 text-icon" />
            <input
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                // Keep typing inside the field (menus use letters for typeahead).
                if (!MOVE_KEYS_PASSED_TO_MENU.includes(event.key)) event.stopPropagation();
              }}
              placeholder="Search folders and workspaces"
              aria-label="Search folders and workspaces"
              data-testid="move-search"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
            />
          </label>
        </div>
      ) : null}
      {rootShown || shownFolders.length > 0 ? <DropdownMenuLabel>Folder</DropdownMenuLabel> : null}
      {rootShown ? (
        <DropdownMenuItem icon={<FolderInput aria-hidden />} disabled={rootDisabled} onSelect={onRoot}>
          {rootLabel}
        </DropdownMenuItem>
      ) : null}
      {shownFolders.map((folder) => (
        <DropdownMenuItem
          key={folder.id}
          icon={<FolderGlyph folderId={folder.id} color={folder.color} />}
          disabled={isFolderDisabled(folder)}
          onSelect={() => onFolder(folder)}
          data-testid="move-target"
        >
          {folder.name}
        </DropdownMenuItem>
      ))}
      {shownWorkspaces.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          {shownWorkspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              icon={<WorkspaceTile workspace={workspace} size={18} />}
              onSelect={() => onWorkspace(workspace)}
              data-testid="move-target"
            >
              {workspace.name}
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {nothing ? (
        <p className="px-3 py-3 text-sm text-fg-muted">No folder or workspace matches “{filter.trim()}”.</p>
      ) : null}
    </>
  );
}

function SubSection({ children }: { readonly children: ReactNode }) {
  return <p className="mb-2 text-xs font-semibold text-fg-muted">{children}</p>;
}

export interface BoardMenuProps {
  readonly board: BoardSummaryDto;
  readonly href: string;
  readonly folders: readonly FolderDto[];
  readonly actions: TreeActions;
  readonly onRename: () => void;
}

export function BoardMenu({ board, href, folders, actions, onRename }: BoardMenuProps) {
  const { org } = useOrg();
  const workspaces = useWorkspaces(org.id);
  const canWrite = useCan('board:write');
  const canCreate = useCan('board:create');
  const canDelete = useCan('board:delete');
  const otherWorkspaces = (workspaces.data ?? []).filter((workspace) => workspace.id !== board.workspaceId);
  return (
    <DropdownMenu>
      <RowMenuTrigger label={`More actions for ${board.name}`} />
      <DropdownMenuContent align="start" side="right" className="w-60" data-testid="board-row-menu">
        <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => window.open(href, '_blank', 'noopener')}>
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Pencil aria-hidden />} disabled={!canWrite} onSelect={onRename} shortcut="F2">
          Rename
        </DropdownMenuItem>
        <FavoriteItem entityType="board" entityId={board.id} name={board.name} boardKind={board.kind} />
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Copy aria-hidden />} disabled={!canCreate}>
            Duplicate
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuItem onSelect={() => void actions.duplicateBoard(board, 'structure')} description="Columns, groups and views">
              Structure only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.duplicateBoard(board, 'items')} description={`All ${pluralize(board.itemTerminology.toLowerCase(), 2)} and values`}>
              Structure and {pluralize(board.itemTerminology.toLowerCase(), 2)}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.duplicateBoard(board, 'items_updates')} description="Includes comments and replies">
              {pluralize(board.itemTerminology, 2)} and updates
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<ArrowRightLeft aria-hidden />} disabled={!canWrite}>
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto" data-testid="move-submenu">
            <MoveTargets
              rootLabel="Workspace root"
              rootDisabled={board.folderId === null}
              onRoot={() => void actions.move({ type: 'board', id: board.id, folderId: null, placement: {} })}
              folders={folders}
              isFolderDisabled={(folder) => folder.id === board.folderId}
              onFolder={(folder) => void actions.move({ type: 'board', id: board.id, folderId: folder.id, placement: {} })}
              workspaces={otherWorkspaces}
              onWorkspace={(workspace) => void actions.moveBoardToWorkspace(board, workspace.id, workspace.name)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => void copyLink(href)}>
          Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Archive aria-hidden />} disabled={!canWrite} onSelect={() => void actions.archiveBoard(board)}>
          Archive
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Trash2 aria-hidden />}
          variant="danger"
          disabled={!canDelete}
          onSelect={() => void actions.deleteBoard(board)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface FolderMenuProps {
  readonly folder: FolderDto;
  readonly actions: TreeActions;
  readonly onRename: () => void;
  /** All folders of the workspace (move targets). Optional for backward compatibility. */
  readonly folders?: readonly FolderDto[];
}

/** Ids of `folderId` and every folder below it (a folder never moves into its own subtree). */
function descendantIds(folders: readonly FolderDto[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function FolderMenu({ folder, actions, onRename, folders = [] }: FolderMenuProps) {
  const { org } = useOrg();
  const workspaces = useWorkspaces(org.id);
  const icons = useFolderIcons(org.id);
  const currentIcon = icons.data?.[folder.id] ?? 'folder';
  const blocked = descendantIds(folders, folder.id);
  const otherWorkspaces = (workspaces.data ?? []).filter((workspace) => workspace.id !== folder.workspaceId);
  const requestCreate = useShellStore((state) => state.requestCreate);
  const collapseAll = useShellStore((state) => state.collapseAllFolders);
  const canCreateBoard = useCan('board:create');
  const canWrite = useCan('workspace:write');
  const [color, setColor] = useState(toLabelColor(folder.color, 'gray'));
  return (
    <DropdownMenu>
      <RowMenuTrigger label={`More actions for folder ${folder.name}`} />
      <DropdownMenuContent align="start" side="right" className="w-60" data-testid="folder-row-menu">
        <DropdownMenuItem
          icon={<Plus aria-hidden />}
          disabled={!canCreateBoard}
          onSelect={() => requestCreate({ kind: 'board', workspaceId: folder.workspaceId, folderId: folder.id })}
        >
          New board in folder
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<FolderPlus aria-hidden />}
          disabled={!canWrite}
          onSelect={() => requestCreate({ kind: 'folder', workspaceId: folder.workspaceId, folderId: folder.id })}
        >
          New sub-folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Pencil aria-hidden />} disabled={!canWrite} onSelect={onRename} shortcut="F2">
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Palette aria-hidden />} disabled={!canWrite}>
            Change color
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto p-3">
            <SubSection>
              Folder color · <span className="text-fg" data-testid="folder-color-name">{LABEL_COLOR_NAMES[color]}</span>
            </SubSection>
            <ColorPicker
              value={color}
              columns={6}
              size="sm"
              label={`Color for ${folder.name}`}
              colors={['gray', 'blue', 'dark-blue', 'purple', 'indigo', 'pink', 'berry', 'red', 'peach', 'orange', 'yellow', 'brown', 'lime', 'green', 'teal', 'sky']}
              onChange={(next) => {
                setColor(next);
                void actions.setFolderColor(folder.id, next);
              }}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Shapes aria-hidden />} disabled={!canWrite}>
            Change icon
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto p-3" data-testid="folder-icon-picker">
            <SubSection>
              Folder icon · <span className="text-fg">{FOLDER_ICON_META[currentIcon].label}</span>
            </SubSection>
            <div role="radiogroup" aria-label={`Icon for ${folder.name}`} className="grid grid-cols-8 gap-1">
              {FOLDER_ICONS.map((name) => {
                const Icon = FOLDER_ICON_META[name].icon;
                const selected = currentIcon === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={FOLDER_ICON_META[name].label}
                    title={FOLDER_ICON_META[name].label}
                    onClick={() => void actions.setFolderIcon(folder.id, name === 'folder' ? null : name)}
                    className={cn(
                      'inline-flex size-8 items-center justify-center rounded-sm text-icon transition-colors hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus',
                      selected && 'bg-primary-selected text-primary-text hover:bg-primary-selected-hover',
                    )}
                  >
                    <Icon
                      aria-hidden
                      className="size-4"
                      style={{ color: selected ? undefined : `var(--label-${color}-text)` }}
                    />
                  </button>
                );
              })}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <FavoriteItem entityType="folder" entityId={folder.id} name={folder.name} />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<ArrowRightLeft aria-hidden />} disabled={!canWrite}>
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto" data-testid="move-submenu">
            <MoveTargets
              rootLabel="Workspace root"
              rootDisabled={folder.parentId === null}
              onRoot={() => void actions.move({ type: 'folder', id: folder.id, parentId: null, placement: {} })}
              folders={folders.filter((entry) => entry.id !== folder.id)}
              isFolderDisabled={(entry) => blocked.has(entry.id) || entry.id === folder.parentId}
              onFolder={(entry) => void actions.move({ type: 'folder', id: folder.id, parentId: entry.id, placement: {} })}
              workspaces={otherWorkspaces}
              onWorkspace={(workspace) =>
                void actions.moveFolderToWorkspace(folder.id, folder.name, workspace.id, workspace.name)
              }
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem icon={<ListCollapse aria-hidden />} onSelect={collapseAll}>
          Collapse all folders
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Archive aria-hidden />}
          disabled={!canWrite}
          onSelect={() => void actions.archiveFolder(folder.id, folder.name)}
          description="Archives the boards inside too"
        >
          Archive folder
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Trash2 aria-hidden />}
          variant="danger"
          disabled={!canWrite}
          onSelect={() => void actions.deleteFolder(folder.id, folder.name)}
          description="Boards inside move up a level"
        >
          Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface DashboardMenuProps {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly actions: TreeActions;
  readonly onRename: () => void;
}

export function DashboardMenu({ id, name, href, actions, onRename }: DashboardMenuProps) {
  const canWrite = useCan('dashboard:write');
  return (
    <DropdownMenu>
      <RowMenuTrigger label={`More actions for ${name}`} />
      <DropdownMenuContent align="start" side="right" className="w-56">
        <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => window.open(href, '_blank', 'noopener')}>
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Pencil aria-hidden />} disabled={!canWrite} onSelect={onRename} shortcut="F2">
          Rename
        </DropdownMenuItem>
        <FavoriteItem entityType="dashboard" entityId={id} name={name} />
        <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => void copyLink(href)}>
          Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Trash2 aria-hidden />}
          variant="danger"
          disabled={!canWrite}
          onSelect={() => void actions.deleteDashboard(id, name)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
