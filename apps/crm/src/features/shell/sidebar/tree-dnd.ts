/**
 * Pure drag-and-drop rules for the sidebar tree: which drop zone the pointer is in, what move
 * that means (reorder / move into folder), and the optimistic tree that results. React-free so
 * it can be unit tested; the server re-validates (cycles, workspace, permissions).
 */
import { generateKeyBetween } from 'fractional-indexing';
import type { WorkspaceTreeDto } from '../api';

export type DropPosition = 'before' | 'after' | 'inside';
export type DraggableType = 'board' | 'folder';

export interface DragNode {
  readonly id: string;
  readonly type: 'board' | 'folder' | 'dashboard';
  /** Folder that contains the node (null = workspace root). */
  readonly parentId: string | null;
}

export interface Placement {
  readonly beforeId?: string;
  readonly afterId?: string;
}

export type TreeMove =
  | { readonly type: 'board'; readonly id: string; readonly folderId: string | null; readonly placement: Placement }
  | { readonly type: 'folder'; readonly id: string; readonly parentId: string | null; readonly placement: Placement };

/** Folder rows: top quarter = before, bottom quarter = after, middle = inside. Others: halves. */
export function dropPositionFor(
  overType: DragNode['type'],
  pointerY: number,
  rect: { readonly top: number; readonly height: number },
): DropPosition {
  const ratio = rect.height > 0 ? (pointerY - rect.top) / rect.height : 0.5;
  if (overType === 'folder') {
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'inside';
  }
  return ratio < 0.5 ? 'before' : 'after';
}

/** Ancestor chain check: is `candidateId` the folder itself or nested inside `folderId`? */
export function isInsideFolder(
  folders: WorkspaceTreeDto['folders'],
  folderId: string,
  candidateId: string | null,
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = candidateId;
  let guard = 0;
  while (current && guard < 64) {
    if (current === folderId) return true;
    current = byId.get(current)?.parentId ?? null;
    guard += 1;
  }
  return false;
}

/** Translate a drop into a move, or null when it is a no-op or not allowed. */
export function resolveDrop(
  tree: WorkspaceTreeDto,
  active: DragNode,
  over: DragNode,
  position: DropPosition,
): TreeMove | null {
  if (active.id === over.id || active.type === 'dashboard') return null;
  const targetParent = position === 'inside' && over.type === 'folder' ? over.id : over.type === 'dashboard' ? null : over.parentId;
  const sameKind = over.type === active.type && position !== 'inside';
  const placement: Placement = sameKind ? (position === 'before' ? { beforeId: over.id } : { afterId: over.id }) : {};

  if (active.type === 'folder') {
    if (isInsideFolder(tree.folders, active.id, targetParent)) return null; // into itself / descendant
    const current = tree.folders.find((folder) => folder.id === active.id);
    if (!current) return null;
    if (current.parentId === targetParent && !sameKind) return null;
    return { type: 'folder', id: active.id, parentId: targetParent, placement };
  }
  const board = tree.boards.find((entry) => entry.id === active.id);
  if (!board) return null;
  if (board.folderId === targetParent && !sameKind) return null;
  return { type: 'board', id: active.id, folderId: targetParent, placement };
}

function positionFor(
  siblings: readonly { readonly id: string; readonly position: string }[],
  placement: Placement,
): string {
  const sorted = [...siblings].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const anchorId = placement.beforeId ?? placement.afterId;
  const index = anchorId ? sorted.findIndex((entry) => entry.id === anchorId) : -1;
  try {
    if (index < 0) return generateKeyBetween(sorted.at(-1)?.position ?? null, null);
    if (placement.beforeId) return generateKeyBetween(sorted[index - 1]?.position ?? null, sorted[index]?.position ?? null);
    return generateKeyBetween(sorted[index]?.position ?? null, sorted[index + 1]?.position ?? null);
  } catch {
    // Legacy keys that fractional-indexing can't bisect: append (the server re-sorts on refetch).
    return `${sorted.at(-1)?.position ?? 'a0'}~`;
  }
}

/** Optimistic tree after a move. */
export function applyMove(tree: WorkspaceTreeDto, move: TreeMove): WorkspaceTreeDto {
  if (move.type === 'board') {
    const siblings = tree.boards.filter((board) => board.folderId === move.folderId && board.id !== move.id);
    const position = positionFor(siblings, move.placement);
    return {
      ...tree,
      boards: tree.boards.map((board) =>
        board.id === move.id ? { ...board, folderId: move.folderId, position } : board,
      ),
    };
  }
  const siblings = tree.folders.filter((folder) => folder.parentId === move.parentId && folder.id !== move.id);
  const position = positionFor(siblings, move.placement);
  return {
    ...tree,
    folders: tree.folders.map((folder) =>
      folder.id === move.id ? { ...folder, parentId: move.parentId, position } : folder,
    ),
  };
}
