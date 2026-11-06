/** Pure listing model for the workspace overview "Content" tab (filter, search, sort). */
import type { BoardSummaryDto, DashboardSummaryDto, FolderDto, WorkspaceTreeDto } from '../api';

export type ContentType = 'all' | 'board' | 'dashboard' | 'folder';
export type ContentSort = 'updated' | 'name' | 'type';

export type ContentRow =
  | { readonly type: 'board'; readonly id: string; readonly name: string; readonly folderName: string | null; readonly updatedAt: string | null; readonly board: BoardSummaryDto }
  | { readonly type: 'dashboard'; readonly id: string; readonly name: string; readonly folderName: null; readonly updatedAt: null; readonly dashboard: DashboardSummaryDto }
  | { readonly type: 'folder'; readonly id: string; readonly name: string; readonly folderName: string | null; readonly updatedAt: null; readonly folder: FolderDto; readonly childCount: number };

const TYPE_ORDER: Readonly<Record<ContentRow['type'], number>> = { folder: 0, board: 1, dashboard: 2 };

export function contentRows(tree: WorkspaceTreeDto): ContentRow[] {
  const folderName = new Map(tree.folders.map((folder) => [folder.id, folder.name]));
  const boards = tree.boards.filter((board) => !board.archivedAt && !board.deletedAt);
  const childCount = (folderId: string) =>
    boards.filter((board) => board.folderId === folderId).length +
    tree.folders.filter((folder) => folder.parentId === folderId).length;
  return [
    ...tree.folders.map(
      (folder): ContentRow => ({
        type: 'folder',
        id: folder.id,
        name: folder.name,
        folderName: folder.parentId ? (folderName.get(folder.parentId) ?? null) : null,
        updatedAt: null,
        folder,
        childCount: childCount(folder.id),
      }),
    ),
    ...boards.map(
      (board): ContentRow => ({
        type: 'board',
        id: board.id,
        name: board.name,
        folderName: board.folderId ? (folderName.get(board.folderId) ?? null) : null,
        updatedAt: board.updatedAt,
        board,
      }),
    ),
    ...tree.dashboards.map(
      (dashboard): ContentRow => ({
        type: 'dashboard',
        id: dashboard.id,
        name: dashboard.name,
        folderName: null,
        updatedAt: null,
        dashboard,
      }),
    ),
  ];
}

/** Folder that directly contains the row (null: workspace root). */
export function parentFolderId(row: ContentRow): string | null {
  if (row.type === 'board') return row.board.folderId;
  if (row.type === 'folder') return row.folder.parentId;
  return null;
}

export function filterAndSort(
  rows: readonly ContentRow[],
  options: {
    readonly type: ContentType;
    readonly query: string;
    readonly sort: ContentSort;
    /** Only the direct contents of this folder. */
    readonly folderId?: string | null;
  },
): ContentRow[] {
  const q = options.query.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (options.type === 'all' || row.type === options.type) &&
      (!q || row.name.toLowerCase().includes(q)) &&
      (!options.folderId || parentFolderId(row) === options.folderId),
  );
  const byName = (a: ContentRow, b: ContentRow) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return [...filtered].sort((a, b) => {
    if (options.sort === 'name') return byName(a, b);
    if (options.sort === 'type') return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || byName(a, b);
    // updated: most recent first; rows without a timestamp keep type order after dated rows.
    const at = a.updatedAt ?? '';
    const bt = b.updatedAt ?? '';
    if (at !== bt) return bt.localeCompare(at);
    return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || byName(a, b);
  });
}
