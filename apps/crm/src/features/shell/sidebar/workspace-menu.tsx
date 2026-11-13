'use client';
/**
 * Workspace "…" menu (SH-045): overview, manage members, rename, color, icon, favorites, sort
 * tree (A–Z / manual), collapse folders, delete
 * (type-the-name confirmation). Shared by the sidebar switcher row and the workspace page header.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownAZ,
  GripVertical,
  LayoutGrid,
  ListCollapse,
  MoreHorizontal,
  Palette,
  Pencil,
  Smile,
  Star,
  StarOff,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Button,
  ColorPicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogBody,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Input,
  toLabelColor,
  toast,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { shellKeys, useFavorites, useToggleFavorite, type WorkspaceDto } from '../api';
import { useCan, useOrg } from '../org-context';
import { routes } from '../routes';
import { startRouteProgress } from '../route-progress';
import { useShellStore } from '../store';

export function useWorkspaceMutations(orgId: string) {
  const queryClient = useQueryClient();
  const key = shellKeys.workspaces(orgId);
  const update = async (workspace: WorkspaceDto, patch: Partial<Pick<WorkspaceDto, 'name' | 'color' | 'description' | 'icon'>>) => {
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<WorkspaceDto[]>(key);
    queryClient.setQueryData<WorkspaceDto[]>(key, (list) =>
      list?.map((entry) => (entry.id === workspace.id ? { ...entry, ...patch } : entry)),
    );
    const treeKey = shellKeys.workspaceTree(orgId, workspace.id);
    const previousTree = queryClient.getQueryData<{ workspace: WorkspaceDto }>(treeKey);
    if (previousTree) {
      queryClient.setQueryData(treeKey, { ...previousTree, workspace: { ...previousTree.workspace, ...patch } });
    }
    try {
      await apiRequest(`/workspaces/${workspace.id}`, { method: 'PATCH', orgId, body: patch });
      return true;
    } catch (error) {
      if (previous) queryClient.setQueryData(key, previous);
      if (previousTree) queryClient.setQueryData(treeKey, previousTree);
      toast.error("Couldn't update the workspace", error instanceof Error ? error.message : undefined);
      return false;
    } finally {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const remove = async (workspace: WorkspaceDto) => {
    await apiRequest(`/workspaces/${workspace.id}`, { method: 'DELETE', orgId });
    await queryClient.invalidateQueries({ queryKey: key });
  };
  return { update, remove };
}

function DeleteWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: {
  readonly workspace: WorkspaceDto;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { org } = useOrg();
  const { remove } = useWorkspaceMutations(org.id);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === workspace.name.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader
          title={`Delete “${workspace.name}”?`}
          description="Its boards, dashboards and folders move to the trash for 30 days. Members lose access immediately."
        />
        <DialogBody>
          <label className="flex flex-col gap-1.5 text-sm text-fg-secondary">
            Type the workspace name to confirm
            <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={workspace.name} aria-label="Workspace name" />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await remove(workspace);
                toast.success(`Workspace “${workspace.name}” deleted`);
                onOpenChange(false);
                startRouteProgress();
                router.push(routes.home(org.slug));
              } catch (error) {
                toast.error("Couldn't delete the workspace", error instanceof Error ? error.message : undefined);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Emoji icons offered for workspaces (WorkspaceTile renders emoji; null = the initial). */
export const WORKSPACE_ICONS: readonly string[] = [
  '🚀', '💼', '📈', '🎯', '🤝', '💡', '🛠️', '📣', '🧭', '🏢', '🌍', '⚡', '🧪', '📦', '🎨', '❤️',
];

export interface WorkspaceMenuProps {
  readonly workspace: WorkspaceDto;
  /** Start inline rename (the caller owns the field). Falls back to the overview page. */
  readonly onRename?: () => void;
  readonly size?: 'sm' | 'md';
}

export function WorkspaceMenu({ workspace, onRename, size = 'sm' }: WorkspaceMenuProps) {
  const router = useRouter();
  const { org } = useOrg();
  const canWrite = useCan('workspace:write');
  const canDelete = useCan('workspace:delete');
  const collapseAll = useShellStore((state) => state.collapseAllFolders);
  const sortMode = useShellStore((state) => state.treeSortByWorkspace[workspace.id] ?? 'manual');
  const setTreeSort = useShellStore((state) => state.setTreeSort);
  const favorites = useFavorites(org.id);
  const toggleFavorite = useToggleFavorite(org.id);
  const { update } = useWorkspaceMutations(org.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const favorite = favorites.data?.find((entry) => entry.entityType === 'workspace' && entry.entityId === workspace.id);
  const overview = routes.workspace(org.slug, workspace.id);
  const open = (href: string) => {
    startRouteProgress();
    router.push(href);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={`Workspace options for ${workspace.name}`}
            icon={<MoreHorizontal aria-hidden />}
            size={size}
            data-testid="workspace-menu"
            className="data-[state=open]:bg-pressed"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem icon={<LayoutGrid aria-hidden />} onSelect={() => open(overview)}>
            Workspace overview
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Users aria-hidden />}
            data-testid="workspace-menu-members"
            onSelect={() => open(`${overview}?tab=members`)}
          >
            Manage members
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Pencil aria-hidden />}
            disabled={!canWrite}
            onSelect={() => (onRename ? onRename() : open(`${overview}?rename=1`))}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Palette aria-hidden />} disabled={!canWrite}>
              Change color
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto p-3">
              <ColorPicker
                value={toLabelColor(workspace.color, 'blue')}
                columns={6}
                size="sm"
                label={`Color for ${workspace.name}`}
                colors={['blue', 'dark-blue', 'indigo', 'purple', 'pink', 'berry', 'red', 'peach', 'orange', 'brown', 'green', 'teal']}
                onChange={(color) => void update(workspace, { color })}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Smile aria-hidden />} disabled={!canWrite} data-testid="workspace-menu-icon">
              Change icon
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto p-2">
              <div role="group" aria-label={`Icon for ${workspace.name}`} className="grid grid-cols-6 gap-1">
                {WORKSPACE_ICONS.map((emoji) => (
                  <DropdownMenuItem
                    key={emoji}
                    aria-label={`Use ${emoji}`}
                    data-selected={workspace.icon === emoji || undefined}
                    className="size-9 justify-center p-0 text-lg data-[selected]:bg-primary-selected"
                    onSelect={() => void update(workspace, { icon: emoji })}
                  >
                    {emoji}
                  </DropdownMenuItem>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!workspace.icon} onSelect={() => void update(workspace, { icon: null })}>
                Use initial letter
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<ArrowDownAZ aria-hidden />} data-testid="workspace-menu-sort">
              Sort tree
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuRadioGroup
                value={sortMode}
                onValueChange={(value) => setTreeSort(workspace.id, value === 'alpha' ? 'alpha' : 'manual')}
              >
                <DropdownMenuRadioItem value="alpha" icon={<ArrowDownAZ aria-hidden />}>
                  Alphabetical (A to Z)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="manual" icon={<GripVertical aria-hidden />}>
                  Manual (drag to reorder)
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            icon={favorite ? <StarOff aria-hidden /> : <Star aria-hidden />}
            onSelect={() =>
              toggleFavorite.mutate(
                { entityType: 'workspace', entityId: workspace.id, favoriteId: favorite?.id, name: workspace.name },
                { onError: () => toast.error("Couldn't update favorites") },
              )
            }
          >
            {favorite ? 'Remove from favorites' : 'Add to favorites'}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<ListCollapse aria-hidden />} onSelect={collapseAll}>
            Collapse all folders
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Trash2 aria-hidden />}
            variant="danger"
            disabled={!canDelete}
            onSelect={() => setConfirmOpen(true)}
          >
            Delete workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteWorkspaceDialog workspace={workspace} open={confirmOpen} onOpenChange={setConfirmOpen} />
    </>
  );
}
