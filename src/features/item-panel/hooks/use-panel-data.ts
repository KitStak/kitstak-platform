'use client';

/**
 * Everything the panel reads: the item detail (columns, group, subitems, links), the board
 * payload (groups, item order, users, permissions) and the signed-in user.
 */
import { useMemo } from 'react';
import { useBoard, useItemDetail, useMe } from '@/lib/hooks';
import type {
  BoardPayloadDto,
  ColumnDto,
  GroupDto,
  ItemDetailDto,
  ItemDto,
  UserSummaryDto,
} from '@/server/services/contracts/dto';
import { neighbors, orderedItemIds, type Neighbors } from '../lib/item-order';

export interface PanelData {
  readonly detail: ItemDetailDto | undefined;
  readonly payload: BoardPayloadDto | undefined;
  readonly item: ItemDto | undefined;
  readonly boardId: string;
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly GroupDto[];
  readonly group: GroupDto | null;
  readonly users: readonly UserSummaryDto[];
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
  readonly me: UserSummaryDto | null;
  readonly canEdit: boolean;
  /** Board item terminology ("Deal"). */
  readonly term: string;
  readonly neighbors: Neighbors;
  /** Top-level items in display order (for keyboard prev/next). */
  readonly orderedIds: readonly string[];
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly refetch: () => void;
}

const EMPTY_NEIGHBORS: Neighbors = { prevId: null, nextId: null, index: 0, total: 0 };

export function usePanelData(itemId: string | null, boardIdProp: string): PanelData {
  const detailQuery = useItemDetail(itemId ?? undefined);
  const detail = detailQuery.data;
  const boardId = detail?.item.boardId ?? boardIdProp;
  const payloadQuery = useBoard(boardId);
  const meQuery = useMe();
  const payload = payloadQuery.data;

  // Prefer the payload copy of the item (it receives optimistic table edits first).
  const item = useMemo(
    () => (itemId ? (payload?.items.find((entry) => entry.id === itemId) ?? detail?.item) : undefined),
    [detail?.item, itemId, payload?.items],
  );
  const users = useMemo(() => payload?.users ?? [], [payload?.users]);
  const usersById = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);
  const groups = payload?.groups ?? [];
  const ids = useMemo(() => (payload ? orderedItemIds(payload.items, payload.groups) : []), [payload]);
  const group = (item && groups.find((entry) => entry.id === item.groupId)) ?? detail?.group ?? null;
  const me = meQuery.data?.user ?? null;

  return {
    detail,
    payload,
    item,
    boardId,
    columns: payload?.columns ?? detail?.columns ?? [],
    groups,
    group,
    users,
    usersById,
    me,
    canEdit: payload?.board.canEdit ?? true,
    term: payload?.board.itemTerminology || detail?.board.itemTerminology || 'Item',
    neighbors: item && !item.parentItemId ? neighbors(ids, item.id) : EMPTY_NEIGHBORS,
    orderedIds: ids,
    isLoading: detailQuery.isLoading,
    error: detailQuery.error,
    refetch: () => {
      void detailQuery.refetch();
      void payloadQuery.refetch();
    },
  };
}
