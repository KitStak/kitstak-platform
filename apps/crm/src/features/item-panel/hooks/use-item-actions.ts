'use client';

/**
 * Header "…" menu actions with board terminology in every toast ("Deal archived · Undo").
 * Archive / delete / move are optimistic on the board caches and roll back on failure.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { toastError, useApi, useDuplicateItem, useMoveItem, useOrgId, useRenameItem } from '@/lib/hooks';
import { removeItemsFromPayload, restore, snapshot } from '@/lib/hooks/cache';
import { queryKeys } from '@/lib/query-keys';
import type { ItemDto } from '@/server/services/contracts/dto';

export function useItemActions(boardId: string, term: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const rename = useRenameItem();
  const duplicate = useDuplicateItem(boardId);
  const move = useMoveItem(boardId);

  const refreshBoard = () => queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, boardId) });
  const refreshItem = (itemId: string) => queryClient.invalidateQueries({ queryKey: queryKeys.item(orgId, itemId) });

  const lifecycle = useMutation({
    mutationFn: (vars: { itemId: string; mode: 'archive' | 'delete' }) =>
      vars.mode === 'archive' ? api.items.lifecycle(vars.itemId, 'archive') : api.items.remove(vars.itemId),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.board(orgId, boardId));
      removeItemsFromPayload(queryClient, orgId, boardId, [vars.itemId]);
      return { saved };
    },
    onError: (error, vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, vars.mode === 'archive' ? `Could not archive the ${term.toLowerCase()}` : `Could not delete the ${term.toLowerCase()}`);
    },
    onSuccess: (_result, vars) => {
      void refreshItem(vars.itemId);
      toast.undo(vars.mode === 'archive' ? `${term} archived` : `${term} moved to trash`, {
        description: vars.mode === 'delete' ? 'Items in trash are removed for good after 30 days.' : undefined,
        onUndo: async () => {
          await api.items.lifecycle(vars.itemId, 'restore');
          await Promise.all([refreshBoard(), refreshItem(vars.itemId)]);
          toast.success(`${term} restored`);
        },
      });
    },
  });

  const restoreItem = useMutation({
    mutationFn: (itemId: string) => api.items.lifecycle(itemId, 'restore'),
    onSuccess: (_result, itemId) => {
      void Promise.all([refreshBoard(), refreshItem(itemId)]);
      toast.success(`${term} restored`);
    },
    onError: (error) => toastError(error, `Could not restore the ${term.toLowerCase()}`),
  });

  return {
    rename: (item: ItemDto, name: string) => rename.mutate({ itemId: item.id, boardId: item.boardId, name }),
    duplicate: (item: ItemDto, onOpen: (id: string) => void) =>
      duplicate.mutate(
        { itemId: item.id, withUpdates: false },
        {
          onSuccess: (copy) =>
            toast.success(`${term} duplicated`, `"${copy.name}" was added below the original.`),
          onSettled: (copy) => {
            if (copy) setTimeout(() => onOpen(copy.id), 0);
          },
        },
      ),
    moveToGroup: (item: ItemDto, groupId: string, groupTitle: string) =>
      move.mutate(
        { itemId: item.id, input: { groupId } },
        {
          onSuccess: () => {
            void refreshItem(item.id);
            toast.success(`${term} moved to ${groupTitle}`);
          },
        },
      ),
    moveToBoard: (item: ItemDto, targetBoardId: string, boardName: string, onMoved: () => void) =>
      move.mutate(
        { itemId: item.id, input: { boardId: targetBoardId } },
        {
          onSuccess: () => {
            void refreshItem(item.id);
            toast.success(`${term} moved to ${boardName}`);
            onMoved();
          },
        },
      ),
    archive: (item: ItemDto) => lifecycle.mutate({ itemId: item.id, mode: 'archive' }),
    remove: (item: ItemDto) => lifecycle.mutate({ itemId: item.id, mode: 'delete' }),
    restore: (item: ItemDto) => restoreItem.mutate(item.id),
    restoring: restoreItem.isPending,
    busy: lifecycle.isPending || move.isPending || duplicate.isPending,
  };
}
