'use client';
import './board-table.css';
import { useCallback } from 'react';
import { ApiClientError } from '@/lib/api';
import type { ViewDto } from '@/server/services/contracts/dto';
import { useBoardData } from './hooks/use-board-data';
import { TableError, TableSkeleton } from './components/table-states';
import type { OpenItemOptions } from './table-context';
import { TableView } from './table-view';

export interface BoardTableProps {
  readonly boardId: string;
  /** The table view being shown (filters, sort, hidden columns, widths and density live in its config). */
  readonly view?: ViewDto | null;
  /** Open the item panel. `options.tab` asks for a specific tab (the updates bubble passes 'updates'). */
  readonly onOpenItem: (itemId: string, options?: OpenItemOptions) => void;
  /** Signed-in user id; realtime skips this user's own events. Defaults to `/me`. */
  readonly currentUserId?: string;
  /** Force read-only (e.g. previews). Boards the user can't edit are read-only anyway. */
  readonly readOnly?: boolean;
  /** Subscribe to realtime board events (default true). */
  readonly realtime?: boolean;
}

/**
 * The board main table: grouped, virtualized, editable grid with sticky headers, drag & drop,
 * column management, bulk actions and keyboard navigation. Must be rendered inside a flex
 * column with a bounded height (it scrolls internally).
 */
export function BoardTable({
  boardId,
  view,
  onOpenItem,
  currentUserId,
  readOnly,
  realtime = true,
}: BoardTableProps) {
  const { payload, items, loadingMore } = useBoardData(boardId, { currentUserId, realtime });
  const open = useCallback(
    (itemId: string, options?: OpenItemOptions) => onOpenItem(itemId, options),
    [onOpenItem],
  );

  if (payload.isPending) {
    return (
      <div className="bt-root">
        <TableSkeleton />
      </div>
    );
  }
  if (payload.isError || !payload.data) {
    const error = payload.error;
    const message =
      error instanceof ApiClientError && error.status === 404
        ? "This board doesn't exist or you don't have access to it."
        : 'Check your connection and try again.';
    return (
      <div className="bt-root">
        <TableError message={message} onRetry={() => void payload.refetch()} />
      </div>
    );
  }
  return (
    <TableView
      key={boardId}
      boardId={boardId}
      payload={payload.data}
      items={items}
      view={view}
      onOpenItem={open}
      loadingMore={loadingMore}
      readOnly={readOnly}
    />
  );
}
