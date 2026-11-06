/**
 * Pure helpers turning a WorkspaceTreeDto into a nested, sorted, filterable tree.
 * Kept free of React so it can be unit tested.
 */
import type { BoardSummaryDto, DashboardSummaryDto, FolderDto, WorkspaceTreeDto } from '../api';

export type TreeNode =
  | {
      readonly type: 'folder';
      readonly id: string;
      readonly folder: FolderDto;
      readonly children: readonly TreeNode[];
    }
  | { readonly type: 'board'; readonly id: string; readonly board: BoardSummaryDto }
  | { readonly type: 'dashboard'; readonly id: string; readonly dashboard: DashboardSummaryDto };

/** Fractional-index keys sort by code unit order (the DB uses the "C" collation). */
function byPosition(a: { readonly position: string }, b: { readonly position: string }): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return 0;
}

const MAX_DEPTH = 8;

export function buildTree(tree: WorkspaceTreeDto): TreeNode[] {
  const folderIds = new Set(tree.folders.map((folder) => folder.id));
  const foldersByParent = new Map<string | null, FolderDto[]>();
  for (const folder of tree.folders) {
    const parent = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
    foldersByParent.set(parent, [...(foldersByParent.get(parent) ?? []), folder]);
  }
  const boardsByFolder = new Map<string | null, BoardSummaryDto[]>();
  for (const board of tree.boards) {
    if (board.deletedAt || board.archivedAt) continue;
    const parent = board.folderId && folderIds.has(board.folderId) ? board.folderId : null;
    boardsByFolder.set(parent, [...(boardsByFolder.get(parent) ?? []), board]);
  }

  const build = (parentId: string | null, depth: number): TreeNode[] => {
    const folders = depth < MAX_DEPTH ? [...(foldersByParent.get(parentId) ?? [])].sort(byPosition) : [];
    const boards = [...(boardsByFolder.get(parentId) ?? [])].sort(byPosition);
    const folderNodes: TreeNode[] = folders.map((folder) => ({
      type: 'folder',
      id: folder.id,
      folder,
      children: build(folder.id, depth + 1),
    }));
    const boardNodes: TreeNode[] = boards.map((board) => ({ type: 'board', id: board.id, board }));
    return [...folderNodes, ...boardNodes];
  };

  const dashboards: TreeNode[] = [...tree.dashboards]
    .sort(byPosition)
    .map((dashboard) => ({ type: 'dashboard', id: dashboard.id, dashboard }));
  return [...build(null, 0), ...dashboards];
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * A–Z order at every level, folders first, then boards, then dashboards (the manual order's
 * grouping is kept so the tree does not interleave kinds).
 */
export function sortTreeAlpha(nodes: readonly TreeNode[]): TreeNode[] {
  const rank = (node: TreeNode) => (node.type === 'folder' ? 0 : node.type === 'board' ? 1 : 2);
  return [...nodes]
    .map((node) => (node.type === 'folder' ? { ...node, children: sortTreeAlpha(node.children) } : node))
    .sort((a, b) => rank(a) - rank(b) || collator.compare(nodeName(a), nodeName(b)));
}

export function nodeName(node: TreeNode): string {
  if (node.type === 'folder') return node.folder.name;
  if (node.type === 'board') return node.board.name;
  return node.dashboard.name;
}

export interface FilterResult {
  readonly nodes: readonly TreeNode[];
  /** Folder ids that must be expanded to reveal matches. */
  readonly expand: readonly string[];
  readonly matchCount: number;
}

/** Keep nodes whose name matches (or that contain a match); folders that match keep all children. */
export function filterTree(nodes: readonly TreeNode[], query: string): FilterResult {
  const q = query.trim().toLowerCase();
  if (!q) return { nodes, expand: [], matchCount: 0 };
  const expand: string[] = [];
  let matchCount = 0;
  const walk = (list: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of list) {
      const matches = nodeName(node).toLowerCase().includes(q);
      if (node.type === 'folder') {
        const children = matches ? node.children : walk(node.children);
        if (matches) matchCount += 1;
        if (matches || children.length > 0) {
          if (children.length > 0) expand.push(node.id);
          out.push({ ...node, children });
        }
      } else if (matches) {
        matchCount += 1;
        out.push(node);
      }
    }
    return out;
  };
  return { nodes: walk(nodes), expand, matchCount };
}

/** Ids of folders containing the given board (to auto-reveal the current page). */
export function ancestorFolderIds(tree: WorkspaceTreeDto, boardId: string): string[] {
  const board = tree.boards.find((entry) => entry.id === boardId);
  if (!board?.folderId) return [];
  const byId = new Map(tree.folders.map((folder) => [folder.id, folder]));
  const result: string[] = [];
  let current = byId.get(board.folderId);
  let guard = 0;
  while (current && guard < MAX_DEPTH + 2) {
    result.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    guard += 1;
  }
  return result;
}
