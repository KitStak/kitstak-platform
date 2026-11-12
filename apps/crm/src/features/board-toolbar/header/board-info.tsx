'use client';

/** Breadcrumb (workspace › folder › board) and the Board info popover (BT-003). */
import Link from 'next/link';
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { Avatar, Button, Popover, PopoverContent, PopoverTrigger, Separator } from '@/components/ui';
import { BOARD_KIND_META, EntityIcon } from '@/features/shell/entity-icon';
import { routes } from '@/features/shell/routes';
import type { BoardDto, FolderDto, UserSummaryDto, WorkspaceDto } from '@/server/services/contracts/dto';

export interface BoardLocation {
  readonly workspace: WorkspaceDto | undefined;
  readonly folders: readonly FolderDto[];
}

/** Folder chain from the workspace root down to `folderId`. */
export function folderPath(folders: readonly FolderDto[], folderId: string | null): FolderDto[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderDto[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  for (let guard = 0; current && guard < 20; guard += 1) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function BoardBreadcrumb({ orgSlug, location, board }: { readonly orgSlug: string; readonly location: BoardLocation; readonly board: BoardDto }) {
  const folders = folderPath(location.folders, board.folderId);
  return (
    <nav aria-label="Breadcrumb" data-testid="board-breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-muted">
        <li className="min-w-0 shrink">
          {location.workspace ? (
            <Link
              href={routes.workspace(orgSlug, location.workspace.id)}
              className="block truncate rounded-xs px-1 -mx-1 transition-colors duration-[var(--duration-instant)] hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
            >
              {location.workspace.name}
            </Link>
          ) : (
            <span className="inline-block h-3 w-20 animate-pulse rounded-full bg-skeleton align-middle" data-skeleton aria-hidden />
          )}
        </li>
        {folders.map((folder) => (
          <li key={folder.id} className="flex min-w-0 shrink items-center gap-1">
            <ChevronRight aria-hidden className="size-3.5 shrink-0" />
            <span className="flex min-w-0 items-center gap-1 truncate">
              <EntityIcon type="folder" color={folder.color} className="size-3.5" />
              <span className="truncate">{folder.name}</span>
            </span>
          </li>
        ))}
        <li className="flex min-w-0 items-center gap-1 max-[520px]:hidden" aria-current="page">
          <ChevronRight aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate text-fg-secondary">{board.name}</span>
        </li>
      </ol>
    </nav>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface BoardInfoProps {
  readonly board: BoardDto;
  readonly users: readonly UserSummaryDto[];
  readonly location: BoardLocation;
  readonly totalItems: number;
  readonly onEditDescription: () => void;
  readonly onOpenSettings: () => void;
}

export function BoardInfoButton({ board, users, location, totalItems, onEditDescription, onOpenSettings }: BoardInfoProps) {
  const owners = board.members
    .filter((member) => member.role === 'owner')
    .map((member) => users.find((user) => user.id === member.userId))
    .filter((user): user is UserSummaryDto => Boolean(user));
  const creator = users.find((user) => user.id === board.createdBy);
  const kind = BOARD_KIND_META[board.kind] ?? BOARD_KIND_META.custom;
  const noun = board.itemTerminology || 'Item';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Board info"
          data-testid="board-info-trigger"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-icon transition-[background-color,color,transform] duration-[var(--duration-instant)] ease-out hover:bg-hover hover:text-fg active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=open]:bg-selected data-[state=open]:text-primary-text [&[data-state=open]>svg]:rotate-180"
        >
          <ChevronDown aria-hidden className="size-4 transition-transform duration-[var(--duration-fast)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(360px,calc(100vw-24px))]" data-testid="board-info">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <EntityIcon type="board" boardKind={board.kind} className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-md font-semibold text-fg">{board.name}</p>
              <p className="text-sm text-fg-muted">
                {kind.label} board · {totalItems.toLocaleString('en-US')} {totalItems === 1 ? noun.toLowerCase() : `${noun.toLowerCase()}s`}
              </p>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-fg-muted ">Description</p>
            {board.description ? (
              <p className="text-base whitespace-pre-wrap text-fg-secondary">{board.description}</p>
            ) : (
              <p className="text-base text-fg-muted">No description yet.</p>
            )}
            {board.canEdit ? (
              <Button variant="tertiary" size="xs" className="mt-1 -ml-2" onClick={onEditDescription}>
                {board.description ? 'Edit description' : 'Add a description'}
              </Button>
            ) : null}
          </div>
          <Separator />
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-base">
            <dt className="text-fg-muted">Owners</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
              {owners.length ? (
                owners.map((owner) => (
                  <span key={owner.id} className="flex min-w-0 items-center gap-1.5">
                    <Avatar name={owner.name} src={owner.image} colorKey={owner.id} size="xs" />
                    <span className="truncate text-fg">{owner.name}</span>
                  </span>
                ))
              ) : (
                <span className="text-fg-muted">Workspace admins</span>
              )}
            </dd>
            <dt className="text-fg-muted">Created</dt>
            <dd className="truncate text-fg">
              {formatDate(board.createdAt)}
              {creator ? <span className="text-fg-muted"> by {creator.name}</span> : null}
            </dd>
            <dt className="text-fg-muted">Workspace</dt>
            <dd className="truncate text-fg">{location.workspace?.name ?? '—'}</dd>
            <dt className="text-fg-muted">Privacy</dt>
            <dd className="text-fg capitalize">{board.privacy === 'main' ? 'Main (everyone in the workspace)' : board.privacy}</dd>
          </dl>
          <Separator />
          <Button variant="ghost" size="sm" leadingIcon={<Settings2 />} onClick={onOpenSettings} className="justify-start">
            Board settings
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
