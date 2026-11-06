'use client';

/** Board payload + item queries and optimistic item mutations. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import { toast } from 'sonner';
import type { Paginated } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { BoardPayloadDto, ItemDto } from '@/server/services/contracts/dto';
import type { BulkItemsInput, CreateItemInput, MoveItemInput } from '@/server/services/contracts/item-inputs';
import type { ItemValues, StoredCellValue } from '@/server/services/contracts/shared';
import {
  findCachedItem,
  patchItemInCaches,
  removeItemsFromPayload,
  restore,
  snapshot,
  toastError,
  upsertItemInPayload,
  type Snapshot,
} from './cache';
import { useApi, useOrgId } from './org-context';

export const BOARD_PAYLOAD_PAGE = 300;

/** First-paint board payload (board, columns, groups, views, first page of items, users). */
export function useBoard(boardId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.boardPayload(orgId, boardId ?? ''),
    queryFn: ({ signal }) => api.boards.full(boardId as string, { limit: BOARD_PAYLOAD_PAGE }, signal),
    enabled: Boolean(boardId),
    staleTime: 30_000,
  });
}

/** Remaining item pages after the payload (pass the payload's `nextCursor`). */
export function useBoardItems(
  boardId: string,
  options: { startCursor?: string | null; groupId?: string; q?: string; enabled?: boolean } = {},
) {
  const api = useApi();
  const orgId = useOrgId();
  const params = { groupId: options.groupId, q: options.q, start: options.startCursor ?? null };
  return useInfiniteQuery({
    queryKey: queryKeys.boardItems(orgId, boardId, params),
    queryFn: ({ pageParam, signal }) =>
      api.items.list(
        boardId,
        { cursor: pageParam ?? undefined, limit: 200, groupId: options.groupId, q: options.q },
        signal,
      ),
    initialPageParam: options.startCursor ?? (null as string | null),
    getNextPageParam: (last: Paginated<ItemDto>) => last.nextCursor,
    enabled: (options.enabled ?? true) && (options.startCursor === undefined || options.startCursor !== null),
  });
}

export function useItemDetail(itemId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.itemDetail(orgId, itemId ?? ''),
    queryFn: ({ signal }) => api.items.detail(itemId as string, signal),
    enabled: Boolean(itemId),
  });
}

export function useSubitems(itemId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.subitems(orgId, itemId ?? ''),
    queryFn: () => api.items.subitems(itemId as string),
    enabled: Boolean(itemId),
  });
}

function applyCell(item: ItemDto, columnKey: string, value: unknown): ItemDto {
  const values: ItemValues = { ...item.values };
  if (value === null || value === undefined) delete values[columnKey];
  else values[columnKey] = value as StoredCellValue;
  return { ...item, values, updatedAt: new Date().toISOString() };
}

interface CellVariables {
  readonly itemId: string;
  readonly boardId: string;
  readonly columnKey: string;
  readonly value: unknown;
}

/** Optimistic single-cell write with rollback + toast on failure. */
export function useUpdateCell() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: CellVariables) => api.items.setCell(vars.itemId, vars.columnKey, vars.value),
    onMutate: async (vars) => {
      const saved = [
        ...(await snapshot(queryClient, queryKeys.board(orgId, vars.boardId))),
        ...(await snapshot(queryClient, queryKeys.item(orgId, vars.itemId))),
      ];
      patchItemInCaches(queryClient, orgId, vars.boardId, vars.itemId, (item) =>
        applyCell(item, vars.columnKey, vars.value),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update the cell');
    },
    onSuccess: (item, vars) => patchItemInCaches(queryClient, orgId, vars.boardId, vars.itemId, () => item),
    onSettled: (_data, _error, vars) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.itemActivity(orgId, vars.itemId) }),
  });
}

/** Optimistic rename. */
export function useRenameItem() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; boardId: string; name: string }) =>
      api.items.update(vars.itemId, { name: vars.name }),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.board(orgId, vars.boardId));
      patchItemInCaches(queryClient, orgId, vars.boardId, vars.itemId, (item) => ({
        ...item,
        name: vars.name,
      }));
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not rename the item');
    },
    onSuccess: (item, vars) => patchItemInCaches(queryClient, orgId, vars.boardId, vars.itemId, () => item),
  });
}

/** Multi-cell update (item panel "save"). */
export function useUpdateItemValues() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; boardId: string; values: Record<string, unknown> }) =>
      api.items.update(vars.itemId, { values: vars.values }),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.board(orgId, vars.boardId));
      patchItemInCaches(queryClient, orgId, vars.boardId, vars.itemId, (item) =>
        Object.entries(vars.values).reduce((acc, [key, value]) => applyCell(acc, key, value), item),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not save changes');
    },
    onSuccess: (item, vars) => patchItemInCaches(queryClient, orgId, vars.boardId, vars.itemId, () => item),
  });
}

function tempItem(boardId: string, input: CreateItemInput & { groupId: string }, position: string): ItemDto {
  const now = new Date().toISOString();
  return {
    id: `temp-${Math.random().toString(36).slice(2, 10)}`,
    boardId,
    groupId: input.groupId,
    parentItemId: input.parentItemId ?? null,
    name: input.name,
    position,
    values: (input.values ?? {}) as ItemValues,
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  };
}

/** Optimistic create: a placeholder row appears instantly and is swapped for the server row. */
export function useCreateItem(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateItemInput) => api.items.create(boardId, input),
    onMutate: async (input) => {
      const saved: Snapshot = await snapshot(queryClient, queryKeys.board(orgId, boardId));
      const payload = queryClient.getQueryData<BoardPayloadDto>(queryKeys.boardPayload(orgId, boardId));
      const groupId = input.groupId ?? payload?.groups[0]?.id;
      if (!payload || !groupId || input.parentItemId) return { saved, tempId: null as string | null };
      const siblings = payload.items
        .filter((item) => item.groupId === groupId)
        .map((item) => item.position)
        .sort();
      let position: string;
      try {
        position =
          input.position === 'top'
            ? generateKeyBetween(null, siblings[0] ?? null)
            : generateKeyBetween(siblings.at(-1) ?? null, null);
      } catch {
        position = 'zzzz';
      }
      const temp = tempItem(boardId, { ...input, groupId }, position);
      upsertItemInPayload(queryClient, orgId, boardId, temp);
      return { saved, tempId: temp.id };
    },
    onError: (error, _input, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not create the item');
    },
    onSuccess: (item, input, context) => {
      if (input.parentItemId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.subitems(orgId, input.parentItemId) });
        patchItemInCaches(queryClient, orgId, boardId, input.parentItemId, (parent) => ({
          ...parent,
          subitemCount: parent.subitemCount + 1,
        }));
        return;
      }
      upsertItemInPayload(queryClient, orgId, boardId, item, context?.tempId ?? undefined);
    },
  });
}

/** Drag & drop move (group change / reorder / other board) with optimistic placement. */
export function useMoveItem(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; input: MoveItemInput; optimisticPosition?: string }) =>
      api.items.move(vars.itemId, vars.input),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.board(orgId, boardId));
      if (vars.input.boardId && vars.input.boardId !== boardId) {
        removeItemsFromPayload(queryClient, orgId, boardId, [vars.itemId]);
      } else {
        const current = findCachedItem(queryClient, orgId, vars.itemId);
        if (current) {
          upsertItemInPayload(queryClient, orgId, boardId, {
            ...current,
            groupId: vars.input.groupId ?? current.groupId,
            position: vars.optimisticPosition ?? current.position,
          });
        }
      }
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not move the item');
    },
    onSuccess: (item) => {
      if (item.boardId === boardId) upsertItemInPayload(queryClient, orgId, boardId, item);
      else void queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, item.boardId) });
    },
  });
}

export function useDuplicateItem(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; withUpdates?: boolean }) =>
      api.items.duplicate(vars.itemId, { withUpdates: vars.withUpdates ?? false, withSubitems: true }),
    onSuccess: (item) => upsertItemInPayload(queryClient, orgId, boardId, item),
    onError: (error) => toastError(error, 'Could not duplicate the item'),
  });
}

/** Archive / delete with an "Undo" toast that restores the item. */
export function useRemoveItem(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; mode: 'archive' | 'delete' }) =>
      vars.mode === 'archive' ? api.items.lifecycle(vars.itemId, 'archive') : api.items.remove(vars.itemId),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.board(orgId, boardId));
      removeItemsFromPayload(queryClient, orgId, boardId, [vars.itemId]);
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not remove the item');
    },
    onSuccess: (_result, vars) => {
      toast.success(vars.mode === 'archive' ? 'Item archived' : 'Item moved to trash', {
        action: {
          label: 'Undo',
          onClick: () => {
            void api.items
              .lifecycle(vars.itemId, 'restore')
              .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }))
              .catch((error: unknown) => toastError(error, 'Could not restore the item'));
          },
        },
      });
    },
  });
}

export function useRestoreItem(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.items.lifecycle(itemId, 'restore'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }),
    onError: (error) => toastError(error, 'Could not restore the item'),
  });
}

/** Multi-select action bar. Deletes/archives are optimistic; other actions refetch. */
export function useBulkItems(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkItemsInput) => api.items.bulk(input),
    onMutate: async (input) => {
      const saved = await snapshot(queryClient, queryKeys.board(orgId, boardId));
      if (
        input.action === 'delete' ||
        input.action === 'archive' ||
        (input.action === 'move' && input.boardId && input.boardId !== boardId)
      ) {
        removeItemsFromPayload(queryClient, orgId, boardId, input.itemIds);
      }
      if (input.action === 'update') {
        for (const itemId of input.itemIds) {
          patchItemInCaches(queryClient, orgId, boardId, itemId, (item) =>
            Object.entries(input.values).reduce((acc, [key, value]) => applyCell(acc, key, value), item),
          );
        }
      }
      return { saved };
    },
    onError: (error, _input, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'The bulk action failed; nothing was changed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }),
  });
}

export function useBulkCreateItems(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId?: string; items: { name: string; values?: Record<string, unknown> }[] }) =>
      api.items.bulkCreate(boardId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }),
    onError: (error) => toastError(error, 'Could not import the items'),
  });
}
