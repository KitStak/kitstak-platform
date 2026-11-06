'use client';

/**
 * Every write the table makes, wrapped around the shared optimistic hooks in src/lib/hooks.
 * Adds what the table needs on top: Undo toasts for destructive actions, multi-item moves,
 * terminology-aware copy and "local change" bookkeeping (so realtime flashes skip our own edits).
 */
import { useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { findCachedItem, removeItemsFromPayload, upsertItemInPayload } from '@/lib/hooks/cache';
import {
  toastError,
  useApi,
  useBulkCreateItems,
  useBulkItems,
  useCreateColumn,
  useCreateGroup,
  useCreateItem,
  useDeleteColumn,
  useDuplicateGroup,
  useDuplicateItem,
  useMoveItem,
  useOrgId,
  useRemoveGroup,
  useRenameItem,
  useRestoreColumn,
  useUpdateCell,
  useUpdateColumn,
  useUpdateGroup,
} from '@/lib/hooks';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnDto, GroupDto, ItemDto } from '@/server/services/contracts/dto';
import type { CellCommitValue } from '@/features/cells';
import { chainPositions, type Placement } from '../lib/ordering';
import { plural } from '../lib/terminology';
import { createSubitemOptimistic } from './create-subitem';

const LOCAL_WINDOW_MS = 4_000;
const BULK_LIMIT = 500;

function chunks<T>(list: readonly T[], size = BULK_LIMIT): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < list.length; start += size) out.push(list.slice(start, start + size));
  return out;
}

export interface TableActions {
  readonly isLocalChange: (itemId: string) => boolean;
  readonly setCell: (item: ItemDto, column: ColumnDto, value: CellCommitValue) => Promise<unknown>;
  readonly rename: (item: ItemDto, name: string) => void;
  readonly createItem: (
    groupId: string,
    name: string,
    placement?: { afterId?: string; beforeId?: string; top?: boolean },
  ) => void;
  readonly createItems: (groupId: string, names: readonly string[]) => Promise<void>;
  readonly createSubitem: (parent: ItemDto, name: string) => void;
  readonly moveItems: (
    items: readonly ItemDto[],
    groupId: string,
    placement: Placement | null,
    upper: string | null,
  ) => void;
  readonly moveToBoard: (itemIds: readonly string[], boardId: string, boardName: string) => void;
  readonly moveToGroup: (itemIds: readonly string[], group: GroupDto) => void;
  readonly duplicateItems: (itemIds: readonly string[]) => void;
  readonly removeItems: (itemIds: readonly string[], mode: 'archive' | 'delete') => void;
  readonly applyValue: (itemIds: readonly string[], column: ColumnDto, value: CellCommitValue) => void;
  readonly createGroup: (
    placement?: { afterId?: string; beforeId?: string },
    title?: string,
  ) => Promise<GroupDto | null>;
  readonly updateGroup: (group: GroupDto, input: { title?: string; color?: string }) => void;
  readonly reorderGroup: (group: GroupDto, placement: Placement) => void;
  readonly duplicateGroup: (group: GroupDto) => void;
  readonly moveGroupToBoard: (group: GroupDto, boardId: string, boardName: string) => void;
  readonly removeGroup: (group: GroupDto, mode: 'archive' | 'delete', itemCount: number) => void;
  readonly createColumn: (
    type: ColumnType,
    options?: { afterId?: string; scope?: 'item' | 'subitem'; title?: string },
  ) => Promise<ColumnDto | null>;
  readonly updateColumn: (
    column: ColumnDto,
    input: { title?: string; description?: string | null; settings?: unknown; type?: ColumnType },
  ) => Promise<void>;
  readonly reorderColumn: (column: ColumnDto, placement: Placement) => void;
  readonly duplicateColumn: (
    column: ColumnDto,
    withValues: boolean,
    items: readonly ItemDto[],
  ) => Promise<void>;
  readonly deleteColumn: (column: ColumnDto) => void;
}

export function useTableActions(boardId: string, terminology: string): TableActions {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const local = useRef(new Map<string, number>());
  const restoring = useRef(new Map<string, Promise<void>>());
  const noun = terminology.toLowerCase();

  const updateCell = useUpdateCell();
  const renameItem = useRenameItem();
  const createItemMutation = useCreateItem(boardId);
  const bulkCreate = useBulkCreateItems(boardId);
  const moveItem = useMoveItem(boardId);
  const duplicateItem = useDuplicateItem(boardId);
  const bulk = useBulkItems(boardId);
  const createGroupMutation = useCreateGroup(boardId);
  const updateGroupMutation = useUpdateGroup(boardId);
  const duplicateGroupMutation = useDuplicateGroup(boardId);
  const removeGroupMutation = useRemoveGroup(boardId);
  const createColumnMutation = useCreateColumn(boardId);
  const updateColumnMutation = useUpdateColumn(boardId);
  const deleteColumnMutation = useDeleteColumn(boardId);
  const restoreColumn = useRestoreColumn(boardId);

  const mark = useCallback((ids: readonly string[]) => {
    const now = Date.now();
    for (const id of ids) local.current.set(id, now);
  }, []);
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) }),
    [boardId, orgId, queryClient],
  );

  const invalidateSubitems = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ['org', orgId, 'item'],
        predicate: (query) => query.queryKey[4] === 'subitems',
      }),
    [orgId, queryClient],
  );

  const restoreItems = useCallback(
    async (itemIds: readonly string[]) => {
      const run = (async () => {
        for (const chunk of chunks(itemIds)) await api.items.bulk({ action: 'restore', itemIds: chunk });
      })();
      for (const id of itemIds) restoring.current.set(id, run);
      try {
        await run;
      } finally {
        for (const id of itemIds) if (restoring.current.get(id) === run) restoring.current.delete(id);
      }
      await Promise.all([invalidate(), invalidateSubitems()]);
    },
    [api, invalidate, invalidateSubitems],
  );

  const removeItems = useCallback(
    (itemIds: readonly string[], mode: 'archive' | 'delete') => {
      const ids = itemIds.filter((id) => !id.startsWith('temp-'));
      if (!ids.length) return;
      mark(ids);
      const removed = ids
        .map((id) => findCachedItem(queryClient, orgId, id))
        .filter((item): item is ItemDto => Boolean(item));
      const hasSubitems = removed.length < ids.length || removed.some((item) => item.parentItemId);
      removeItemsFromPayload(queryClient, orgId, boardId, ids);
      const label = `${ids.length} ${plural(noun, ids.length)}`;
      // Never let a delete race an in-flight Undo of the same rows.
      const restores = ids
        .map((id) => restoring.current.get(id))
        .filter((entry): entry is Promise<void> => Boolean(entry));
      const pending = Promise.all(restores.map((entry) => entry.catch(() => undefined))).then(() =>
        Promise.all(chunks(ids).map((chunk) => bulk.mutateAsync({ action: mode, itemIds: chunk }))),
      );
      // Optimistic: the Undo toast shows right away; Undo waits for the write before restoring.
      const toastId = toast.undo(mode === 'archive' ? `${label} archived` : `${label} deleted`, {
        description: mode === 'delete' ? 'Deleted items stay in Trash for 30 days.' : undefined,
        onUndo: async () => {
          mark(ids);
          for (const item of removed)
            if (!item.parentItemId) upsertItemInPayload(queryClient, orgId, boardId, item);
          await pending.catch(() => undefined);
          await restoreItems(ids);
        },
      });
      void pending
        .then(() => {
          if (hasSubitems) void invalidateSubitems();
        })
        .catch(() => toast.dismiss(toastId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bulk.mutateAsync is stable
    [boardId, mark, noun, orgId, queryClient, restoreItems],
  );

  return useMemo<TableActions>(
    () => ({
      isLocalChange: (itemId) => {
        const at = local.current.get(itemId);
        return at !== undefined && Date.now() - at < LOCAL_WINDOW_MS;
      },
      setCell: (item, column, value) => {
        mark([item.id]);
        return updateCell.mutateAsync({
          itemId: item.id,
          boardId: item.boardId,
          columnKey: column.key,
          value,
        });
      },
      rename: (item, name) => {
        const next = name.trim();
        if (!next || next === item.name) return;
        mark([item.id]);
        renameItem.mutate({ itemId: item.id, boardId: item.boardId, name: next });
      },
      createItem: (groupId, name, placement) => {
        const next = name.trim();
        if (!next) return;
        createItemMutation.mutate(
          {
            name: next,
            groupId,
            ...(placement?.top && { position: 'top' as const }),
            ...(placement?.afterId && { afterId: placement.afterId }),
            ...(placement?.beforeId && { beforeId: placement.beforeId }),
          },
          { onSuccess: (item) => mark([item.id]) },
        );
      },
      createItems: async (groupId, names) => {
        const clean = names
          .map((name) => name.trim())
          .filter(Boolean)
          .slice(0, BULK_LIMIT);
        if (!clean.length) return;
        try {
          const created = await bulkCreate.mutateAsync({ groupId, items: clean.map((name) => ({ name })) });
          mark(created.map((item) => item.id));
          toast.undo(`${created.length} ${plural(noun, created.length)} created`, {
            onUndo: async () => {
              await api.items.bulk({ action: 'delete', itemIds: created.map((item) => item.id) });
              await invalidate();
            },
          });
        } catch {
          // useBulkCreateItems already toasts the failure.
        }
      },
      createSubitem: (parent, name) => {
        const next = name.trim();
        if (!next) return;
        void createSubitemOptimistic({ api, queryClient, orgId, boardId, onCreated: (item) => mark([item.id]) }, parent, next);
      },
      moveItems: (items, groupId, placement, upper) => {
        const movable = items.filter((item) => !item.id.startsWith('temp-'));
        if (!movable.length) return;
        mark(movable.map((item) => item.id));
        if (!placement) {
          for (const item of movable) moveItem.mutate({ itemId: item.id, input: { groupId } });
          return;
        }
        const positions = chainPositions(placement, movable.length, upper);
        let afterId = placement.afterId;
        movable.forEach((item, index) => {
          const input =
            index === 0
              ? {
                  groupId,
                  ...(placement.afterId && { afterId: placement.afterId }),
                  ...(placement.beforeId && { beforeId: placement.beforeId }),
                }
              : { groupId, afterId };
          moveItem.mutate({ itemId: item.id, input, optimisticPosition: positions[index] });
          afterId = item.id;
        });
      },
      moveToBoard: (itemIds, targetBoardId, boardName) => {
        mark(itemIds);
        void Promise.all(
          chunks(itemIds).map((chunk) =>
            bulk.mutateAsync({ action: 'move', itemIds: chunk, boardId: targetBoardId }),
          ),
        )
          .then(() =>
            toast.success(`Moved ${itemIds.length} ${plural(noun, itemIds.length)} to ${boardName}`),
          )
          .catch(() => undefined);
      },
      moveToGroup: (itemIds, group) => {
        mark(itemIds);
        void Promise.all(
          chunks(itemIds).map((chunk) =>
            bulk.mutateAsync({ action: 'move', itemIds: chunk, groupId: group.id }),
          ),
        )
          .then(() =>
            toast.success(`Moved ${itemIds.length} ${plural(noun, itemIds.length)} to ${group.title}`),
          )
          .catch(() => undefined);
      },
      duplicateItems: (itemIds) => {
        if (itemIds.length === 1 && itemIds[0]) {
          duplicateItem.mutate({ itemId: itemIds[0] }, { onSuccess: (item) => mark([item.id]) });
          return;
        }
        void Promise.all(
          chunks(itemIds).map((chunk) => bulk.mutateAsync({ action: 'duplicate', itemIds: chunk })),
        )
          .then(() => toast.success(`Duplicated ${itemIds.length} ${plural(noun, itemIds.length)}`))
          .catch(() => undefined);
      },
      removeItems,
      applyValue: (itemIds, column, value) => {
        mark(itemIds);
        void Promise.all(
          chunks(itemIds).map((chunk) =>
            bulk.mutateAsync({ action: 'update', itemIds: chunk, values: { [column.key]: value } }),
          ),
        )
          .then(() =>
            toast.success(`Updated ${column.title} on ${itemIds.length} ${plural(noun, itemIds.length)}`),
          )
          .catch(() => undefined);
      },
      createGroup: async (placement, title = 'New group') => {
        try {
          return await createGroupMutation.mutateAsync({ title, ...placement });
        } catch {
          return null;
        }
      },
      updateGroup: (group, input) =>
        updateGroupMutation.mutate({ groupId: group.id, input: input as { title?: string; color?: never } }),
      reorderGroup: (group, placement) =>
        updateGroupMutation.mutate({
          groupId: group.id,
          input: {
            ...(placement.afterId && { afterId: placement.afterId }),
            ...(placement.beforeId && { beforeId: placement.beforeId }),
          },
          optimisticPosition: placement.position,
        }),
      duplicateGroup: (group) =>
        duplicateGroupMutation.mutate(group.id, {
          onSuccess: () => toast.success(`Duplicated “${group.title}”`),
        }),
      moveGroupToBoard: (group, targetBoardId, boardName) =>
        updateGroupMutation.mutate(
          { groupId: group.id, input: { targetBoardId } },
          { onSuccess: () => toast.success(`Moved “${group.title}” to ${boardName}`) },
        ),
      removeGroup: (group, mode, itemCount) =>
        removeGroupMutation.mutate(
          { groupId: group.id, mode },
          {
            onSuccess: () =>
              toast.undo(
                mode === 'archive' ? `Group “${group.title}” archived` : `Group “${group.title}” deleted`,
                {
                  description: itemCount
                    ? `${itemCount} ${plural(noun, itemCount)} ${mode === 'archive' ? 'archived' : 'moved to Trash'}`
                    : undefined,
                  onUndo: async () => {
                    if (mode === 'archive') await api.groups.archive(boardId, group.id, false);
                    else
                      await apiRequest('/trash/restore', {
                        orgId,
                        method: 'POST',
                        body: { entries: [{ type: 'group', id: group.id }] },
                      });
                    await invalidate();
                  },
                },
              ),
          },
        ),
      createColumn: async (type, options = {}) => {
        const definition = COLUMN_TYPE_REGISTRY[type];
        try {
          return await createColumnMutation.mutateAsync({
            title: options.title ?? definition.label,
            type,
            scope: options.scope ?? 'item',
            ...(options.afterId && { afterId: options.afterId }),
          });
        } catch {
          return null;
        }
      },
      updateColumn: async (column, input) => {
        try {
          await updateColumnMutation.mutateAsync({ columnId: column.id, input: input as never });
        } catch {
          // Rolled back + toasted by useUpdateColumn.
        }
      },
      reorderColumn: (column, placement) =>
        updateColumnMutation.mutate({
          columnId: column.id,
          input: {
            ...(placement.afterId && { afterId: placement.afterId }),
            ...(placement.beforeId && { beforeId: placement.beforeId }),
          },
          optimisticPosition: placement.position,
        }),
      duplicateColumn: async (column, withValues, items) => {
        try {
          const copy = await createColumnMutation.mutateAsync({
            title: `${column.title} (copy)`,
            type: column.type,
            scope: column.scope,
            settings: column.settings,
            afterId: column.id,
          });
          if (!withValues) return;
          const byValue = new Map<string, string[]>();
          for (const item of items) {
            const value = item.values[column.key];
            if (value === undefined) continue;
            const key = JSON.stringify(value);
            byValue.set(key, [...(byValue.get(key) ?? []), item.id]);
          }
          for (const [json, ids] of byValue) {
            for (const chunk of chunks(ids)) {
              await api.items.bulk({
                action: 'update',
                itemIds: chunk,
                values: { [copy.key]: JSON.parse(json) as unknown },
              });
            }
          }
          await invalidate();
          toast.success(`Duplicated “${column.title}” with values`);
        } catch (error) {
          toastError(error, 'Could not duplicate the column');
        }
      },
      deleteColumn: (column) =>
        deleteColumnMutation.mutate(column.id, {
          onSuccess: () =>
            toast.undo(`Column “${column.title}” deleted`, {
              onUndo: async () => {
                await restoreColumn.mutateAsync(column.id);
                await invalidate();
              },
            }),
        }),
    }),
    // Mutation objects change identity every render; their `mutate` functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, boardId, invalidate, mark, noun, orgId, removeItems],
  );
}
