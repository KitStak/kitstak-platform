'use client';
/**
 * Sidebar tree mutations. Every action patches the cached workspace tree optimistically, rolls
 * back + toasts on failure, and destructive ones offer Undo:
 *   - archive / delete board → server-side restore on Undo (`/lifecycle`)
 *   - delete folder / dashboard → the server call is deferred until the Undo window closes (there
 *     is no restore endpoint), and flushed with `keepalive` if the page is hidden first.
 */
import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { toast } from '@/components/ui';
import { shellKeys, type BoardSummaryDto, type FolderIcon, type WorkspaceTreeDto } from '../api';
import { applyMove, type TreeMove } from './tree-dnd';

const UNDO_WINDOW_MS = 8000;

type TreeUpdater = (tree: WorkspaceTreeDto) => WorkspaceTreeDto;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Please try again.';
}

/** Deferred deletes still waiting for their Undo window, flushed when the page is hidden. */
const pendingDeletes = new Map<string, { url: string; orgId: string; timer: number }>();
let flushListenerInstalled = false;

function flushPendingDeletes(): void {
  for (const [key, entry] of pendingDeletes) {
    window.clearTimeout(entry.timer);
    void fetch(`/api/v1${entry.url}`, {
      method: 'DELETE',
      keepalive: true,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'x-org-id': entry.orgId },
    });
    pendingDeletes.delete(key);
  }
}

function ensureFlushListener(): void {
  if (flushListenerInstalled || typeof window === 'undefined') return;
  flushListenerInstalled = true;
  window.addEventListener('pagehide', flushPendingDeletes);
}

async function patchTree(
  queryClient: QueryClient,
  orgId: string,
  workspaceId: string,
  update: TreeUpdater,
): Promise<WorkspaceTreeDto | undefined> {
  const key = shellKeys.workspaceTree(orgId, workspaceId);
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<WorkspaceTreeDto>(key);
  if (previous) queryClient.setQueryData<WorkspaceTreeDto>(key, update(previous));
  return previous;
}

export function useTreeActions(orgId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  const treeKey = shellKeys.workspaceTree(orgId, workspaceId);

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: shellKeys.workspaces(orgId) }),
        queryClient.invalidateQueries({ queryKey: shellKeys.favorites(orgId) }),
        queryClient.invalidateQueries({ queryKey: ['org', orgId, 'recents'] }),
      ]),
    [queryClient, orgId],
  );

  /** Optimistic mutation with rollback + error toast. Resolves true on success. */
  const optimistic = useCallback(
    async (
      update: TreeUpdater,
      call: () => Promise<unknown>,
      failure: string | ((error: unknown) => void),
    ): Promise<boolean> => {
      const previous = await patchTree(queryClient, orgId, workspaceId, update);
      try {
        await call();
        return true;
      } catch (error) {
        if (previous) queryClient.setQueryData(treeKey, previous);
        if (typeof failure === 'string') toast.error(failure, errorText(error));
        else failure(error);
        return false;
      } finally {
        void refresh();
      }
    },
    [queryClient, orgId, workspaceId, treeKey, refresh],
  );

  const renameBoard = (boardId: string, name: string) =>
    optimistic(
      (tree) => ({ ...tree, boards: tree.boards.map((b) => (b.id === boardId ? { ...b, name } : b)) }),
      () => apiRequest(`/boards/${boardId}`, { method: 'PATCH', orgId, body: { name } }),
      "Couldn't rename the board",
    );

  const renameFolder = (folderId: string, name: string) =>
    optimistic(
      (tree) => ({ ...tree, folders: tree.folders.map((f) => (f.id === folderId ? { ...f, name } : f)) }),
      () => apiRequest(`/folders/${folderId}`, { method: 'PATCH', orgId, body: { name } }),
      "Couldn't rename the folder",
    );

  const renameDashboard = (dashboardId: string, name: string) =>
    optimistic(
      (tree) => ({
        ...tree,
        dashboards: tree.dashboards.map((d) => (d.id === dashboardId ? { ...d, name } : d)),
      }),
      () => apiRequest(`/dashboards/${dashboardId}`, { method: 'PATCH', orgId, body: { name } }),
      "Couldn't rename the dashboard",
    );

  const setFolderColor = (folderId: string, color: string) =>
    optimistic(
      (tree) => ({ ...tree, folders: tree.folders.map((f) => (f.id === folderId ? { ...f, color } : f)) }),
      () => apiRequest(`/folders/${folderId}`, { method: 'PATCH', orgId, body: { color } }),
      "Couldn't change the folder color",
    );

  const move = async (treeMove: TreeMove): Promise<boolean> => {
    const run = () =>
      treeMove.type === 'board'
        ? apiRequest(`/boards/${treeMove.id}`, {
            method: 'PATCH',
            orgId,
            body: { folderId: treeMove.folderId, ...treeMove.placement },
          })
        : apiRequest(`/folders/${treeMove.id}`, {
            method: 'PATCH',
            orgId,
            body: { parentId: treeMove.parentId, ...treeMove.placement },
          });
    return optimistic((tree) => applyMove(tree, treeMove), run, (error) =>
      toast.undo(`Couldn't move the ${treeMove.type}`, {
        description: errorText(error),
        undoLabel: 'Retry',
        onUndo: () => void move(treeMove),
      }),
    );
  };

  /** Move a board to another workspace (optionally into one of its folders). */
  const moveBoardToWorkspace = (board: BoardSummaryDto, targetWorkspaceId: string, targetName: string) =>
    optimistic(
      (tree) => ({ ...tree, boards: tree.boards.filter((b) => b.id !== board.id) }),
      async () => {
        await apiRequest(`/boards/${board.id}`, {
          method: 'PATCH',
          orgId,
          body: { workspaceId: targetWorkspaceId, folderId: null },
        });
        toast.success(`Moved “${board.name}” to ${targetName}`);
        await queryClient.invalidateQueries({ queryKey: shellKeys.workspaceTree(orgId, targetWorkspaceId) });
      },
      "Couldn't move the board",
    );

  const duplicateBoard = async (board: BoardSummaryDto, mode: 'structure' | 'items' | 'items_updates') => {
    const pending = toast.loading(`Duplicating “${board.name}”…`);
    try {
      const copy = await apiRequest<BoardSummaryDto>(`/boards/${board.id}/duplicate`, {
        method: 'POST',
        orgId,
        body: { mode, folderId: board.folderId },
      });
      toast.dismiss(pending);
      toast.success(`Created “${copy.name}”`);
      await queryClient.invalidateQueries({ queryKey: treeKey });
      return copy;
    } catch (error) {
      toast.dismiss(pending);
      toast.error("Couldn't duplicate the board", errorText(error));
      return null;
    }
  };

  /**
   * Archive / delete: the row leaves the tree and the Undo toast appears in the same frame
   * (no wait on the server). Undo waits for the request to land, then restores. A failed
   * request swaps the toast for an error and rolls the tree back.
   */
  const lifecycle = async (board: BoardSummaryDto, action: 'archive' | 'delete') => {
    let settled: Promise<boolean> = Promise.resolve(false);
    const toastId = toast.undo(action === 'delete' ? `“${board.name}” moved to trash` : `“${board.name}” archived`, {
      onUndo: async () => {
        if (!(await settled)) return; // the request failed: the tree was already rolled back
        await apiRequest(`/boards/${board.id}/lifecycle`, {
          method: 'POST',
          orgId,
          body: { action: action === 'delete' ? 'restore' : 'unarchive' },
        });
        await queryClient.invalidateQueries({ queryKey: treeKey });
        void refresh();
        toast.success('Restored');
      },
    });
    settled = optimistic(
      (tree) => ({ ...tree, boards: tree.boards.filter((b) => b.id !== board.id) }),
      () =>
        action === 'delete'
          ? apiRequest(`/boards/${board.id}`, { method: 'DELETE', orgId })
          : apiRequest(`/boards/${board.id}/lifecycle`, { method: 'POST', orgId, body: { action: 'archive' } }),
      (error) => {
        toast.dismiss(toastId);
        toast.error(action === 'delete' ? "Couldn't delete the board" : "Couldn't archive the board", errorText(error));
      },
    );
    await settled;
  };

  /** Folder / dashboard delete with a deferred commit (Undo cancels it entirely). */
  const deferredDelete = async (kind: 'folder' | 'dashboard', id: string, name: string) => {
    ensureFlushListener();
    const previous = await patchTree(queryClient, orgId, workspaceId, (tree) =>
      kind === 'folder'
        ? {
            ...tree,
            // Mirrors the server: contents move up to the parent folder.
            folders: tree.folders
              .filter((f) => f.id !== id)
              .map((f) => (f.parentId === id ? { ...f, parentId: tree.folders.find((p) => p.id === id)?.parentId ?? null } : f)),
            boards: tree.boards.map((b) =>
              b.folderId === id ? { ...b, folderId: tree.folders.find((p) => p.id === id)?.parentId ?? null } : b,
            ),
          }
        : { ...tree, dashboards: tree.dashboards.filter((d) => d.id !== id) },
    );
    const url = kind === 'folder' ? `/folders/${id}` : `/dashboards/${id}`;
    const key = `${kind}:${id}`;
    const commit = async () => {
      pendingDeletes.delete(key);
      try {
        await apiRequest(url, { method: 'DELETE', orgId });
      } catch (error) {
        if (previous) queryClient.setQueryData(treeKey, previous);
        toast.error(`Couldn't delete the ${kind}`, errorText(error));
      } finally {
        void refresh();
        void queryClient.invalidateQueries({ queryKey: treeKey });
      }
    };
    const timer = window.setTimeout(() => void commit(), UNDO_WINDOW_MS);
    pendingDeletes.set(key, { url, orgId, timer });
    toast.undo(kind === 'folder' ? `Folder “${name}” deleted` : `Dashboard “${name}” deleted`, {
      description: kind === 'folder' ? 'Its boards moved up a level.' : undefined,
      duration: UNDO_WINDOW_MS,
      onUndo: () => {
        const entry = pendingDeletes.get(key);
        if (!entry) throw new Error('It was already deleted.');
        window.clearTimeout(entry.timer);
        pendingDeletes.delete(key);
        if (previous) queryClient.setQueryData(treeKey, previous);
        toast.success('Restored');
      },
    });
  };

  /** All folder ids in the subtree rooted at `folderId` (inclusive), from the cached tree. */
  const subtree = (tree: WorkspaceTreeDto, folderId: string): Set<string> => {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of tree.folders) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          grew = true;
        }
      }
    }
    return ids;
  };
  const withoutSubtree = (folderId: string): TreeUpdater => (tree) => {
    const ids = subtree(tree, folderId);
    return {
      ...tree,
      folders: tree.folders.filter((folder) => !ids.has(folder.id)),
      boards: tree.boards.filter((board) => !board.folderId || !ids.has(board.folderId)),
    };
  };

  /** Archive a folder with its boards; Undo restores both on the server. */
  const archiveFolder = async (folderId: string, name: string) => {
    let archived: { folderIds: string[]; boardIds: string[] } | null = null;
    const ok = await optimistic(
      withoutSubtree(folderId),
      async () => {
        archived = await apiRequest<{ folderIds: string[]; boardIds: string[] }>(`/shell/folders/${folderId}/archive`, {
          method: 'POST',
          orgId,
          body: {},
        });
      },
      "Couldn't archive the folder",
    );
    const result = archived as { folderIds: string[]; boardIds: string[] } | null;
    if (!ok || !result) return;
    const count = result.boardIds.length;
    toast.undo(`Folder “${name}” archived`, {
      description: count > 0 ? `${count} ${count === 1 ? 'board' : 'boards'} archived with it.` : undefined,
      onUndo: async () => {
        await apiRequest('/shell/folders/restore', { method: 'POST', orgId, body: result });
        await queryClient.invalidateQueries({ queryKey: treeKey });
        void refresh();
        toast.success('Folder restored');
      },
    });
  };

  /** Move a folder (with everything inside) to the top level of another workspace. */
  const moveFolderToWorkspace = (folderId: string, name: string, targetWorkspaceId: string, targetName: string) =>
    optimistic(
      withoutSubtree(folderId),
      async () => {
        await apiRequest(`/shell/folders/${folderId}/move`, {
          method: 'POST',
          orgId,
          body: { workspaceId: targetWorkspaceId },
        });
        toast.success(`Moved “${name}” to ${targetName}`);
        await queryClient.invalidateQueries({ queryKey: shellKeys.workspaceTree(orgId, targetWorkspaceId) });
      },
      "Couldn't move the folder",
    );

  /** Custom folder icon (stored org-wide); optimistic on the icon map. */
  const setFolderIcon = async (folderId: string, icon: FolderIcon | null) => {
    const key = [...shellKeys.workspaces(orgId), 'folder-icons'] as const;
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<Record<string, FolderIcon>>(key);
    queryClient.setQueryData<Record<string, FolderIcon>>(key, (current = {}) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => id !== folderId));
      return icon ? { ...next, [folderId]: icon } : next;
    });
    try {
      await apiRequest(`/shell/folders/${folderId}/icon`, { method: 'PUT', orgId, body: { icon } });
      return true;
    } catch (error) {
      queryClient.setQueryData(key, previous);
      toast.error("Couldn't change the folder icon", errorText(error));
      return false;
    }
  };

  return {
    archiveFolder,
    moveFolderToWorkspace,
    setFolderIcon,
    renameBoard,
    renameFolder,
    renameDashboard,
    setFolderColor,
    move,
    moveBoardToWorkspace,
    duplicateBoard,
    archiveBoard: (board: BoardSummaryDto) => lifecycle(board, 'archive'),
    deleteBoard: (board: BoardSummaryDto) => lifecycle(board, 'delete'),
    deleteFolder: (folderId: string, name: string) => deferredDelete('folder', folderId, name),
    deleteDashboard: (dashboardId: string, name: string) => deferredDelete('dashboard', dashboardId, name),
  };
}

export type TreeActions = ReturnType<typeof useTreeActions>;
