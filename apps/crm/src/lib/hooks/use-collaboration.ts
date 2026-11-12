'use client';

/** Item updates (comments), files and activity feeds. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { ActivityDto, UpdateDto } from '@/server/services/contracts/dto';
import type { CreateUpdateInput } from '@/server/services/contracts/item-inputs';
import { patchItemInCaches, restore, snapshot, toastError } from './cache';
import { useApi, useOrgId } from './org-context';

export function useItemUpdates(itemId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.itemUpdates(orgId, itemId ?? ''),
    queryFn: () => api.updates.list(itemId as string),
    enabled: Boolean(itemId),
  });
}

function replaceUpdate(list: UpdateDto[] | undefined, next: UpdateDto): UpdateDto[] | undefined {
  return list?.map((thread) =>
    thread.id === next.id
      ? { ...next, replies: thread.replies }
      : { ...thread, replies: thread.replies.map((reply) => (reply.id === next.id ? next : reply)) },
  );
}

export function useCreateUpdate(itemId: string, boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUpdateInput) => api.updates.create(itemId, input),
    onSuccess: (update) => {
      queryClient.setQueryData<UpdateDto[]>(queryKeys.itemUpdates(orgId, itemId), (list) => {
        if (!list) return list;
        if (update.parentUpdateId) {
          return list.map((thread) =>
            thread.id === update.parentUpdateId
              ? { ...thread, replies: [...thread.replies, update] }
              : thread,
          );
        }
        const pinned = list.filter((thread) => thread.pinned);
        return [...pinned, update, ...list.filter((thread) => !thread.pinned)];
      });
      if (!update.parentUpdateId) {
        patchItemInCaches(queryClient, orgId, boardId, itemId, (item) => ({
          ...item,
          updateCount: item.updateCount + 1,
        }));
      }
    },
    onError: (error) => toastError(error, 'Could not post the update'),
  });
}

export function useEditUpdate(itemId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { updateId: string; body: CreateUpdateInput['body'] }) =>
      api.updates.edit(vars.updateId, { body: vars.body }),
    onSuccess: (update) =>
      queryClient.setQueryData<UpdateDto[]>(queryKeys.itemUpdates(orgId, itemId), (list) =>
        replaceUpdate(list, update),
      ),
    onError: (error) => toastError(error, 'Could not edit the update'),
  });
}

export function useDeleteUpdate(itemId: string, boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updateId: string) => api.updates.remove(updateId),
    onMutate: async (updateId) => {
      const saved = await snapshot(queryClient, queryKeys.itemUpdates(orgId, itemId));
      const list = queryClient.getQueryData<UpdateDto[]>(queryKeys.itemUpdates(orgId, itemId));
      const isThread = list?.some((thread) => thread.id === updateId) ?? false;
      queryClient.setQueryData<UpdateDto[]>(queryKeys.itemUpdates(orgId, itemId), (current) =>
        current
          ?.filter((thread) => thread.id !== updateId)
          .map((thread) => ({ ...thread, replies: thread.replies.filter((reply) => reply.id !== updateId) })),
      );
      if (isThread)
        patchItemInCaches(queryClient, orgId, boardId, itemId, (item) => ({
          ...item,
          updateCount: Math.max(0, item.updateCount - 1),
        }));
      return { saved };
    },
    onError: (error, _id, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not delete the update');
    },
  });
}

export function usePinUpdate(itemId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { updateId: string; pinned: boolean }) => api.updates.pin(vars.updateId, vars.pinned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.itemUpdates(orgId, itemId) }),
    onError: (error) => toastError(error, 'Could not pin the update'),
  });
}

/** Optimistic reaction toggle. */
export function useToggleReaction(itemId: string, currentUserId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const toggle = (update: UpdateDto, emoji: string): UpdateDto => {
    const existing = update.reactions.find((reaction) => reaction.emoji === emoji);
    const reactions = existing
      ? update.reactions
          .map((reaction) =>
            reaction.emoji !== emoji
              ? reaction
              : reaction.reactedByMe
                ? {
                    ...reaction,
                    count: reaction.count - 1,
                    reactedByMe: false,
                    userIds: reaction.userIds.filter((id) => id !== currentUserId),
                  }
                : {
                    ...reaction,
                    count: reaction.count + 1,
                    reactedByMe: true,
                    userIds: [...reaction.userIds, currentUserId],
                  },
          )
          .filter((reaction) => reaction.count > 0)
      : [...update.reactions, { emoji, count: 1, userIds: [currentUserId], reactedByMe: true }];
    return { ...update, reactions };
  };
  return useMutation({
    mutationFn: (vars: { updateId: string; emoji: string }) => api.updates.react(vars.updateId, vars.emoji),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.itemUpdates(orgId, itemId));
      queryClient.setQueryData<UpdateDto[]>(queryKeys.itemUpdates(orgId, itemId), (list) =>
        list?.map((thread) => ({
          ...(thread.id === vars.updateId ? toggle(thread, vars.emoji) : thread),
          replies: thread.replies.map((reply) =>
            reply.id === vars.updateId ? toggle(reply, vars.emoji) : reply,
          ),
        })),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not react');
    },
    onSuccess: (update) =>
      queryClient.setQueryData<UpdateDto[]>(queryKeys.itemUpdates(orgId, itemId), (list) =>
        replaceUpdate(list, update),
      ),
  });
}

export function useMarkItemUpdatesRead(itemId: string) {
  const api = useApi();
  return useMutation({ mutationFn: () => api.updates.markItemRead(itemId) });
}

export function useItemFiles(itemId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.itemFiles(orgId, itemId ?? ''),
    queryFn: () => api.items.files(itemId as string),
    enabled: Boolean(itemId),
  });
}

export function useBoardFiles(boardId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.boardFiles(orgId, boardId ?? ''),
    queryFn: () => api.boards.files(boardId as string),
    enabled: Boolean(boardId),
  });
}

export function useUploadFile(itemId: string, boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; updateId?: string; columnKey?: string }) =>
      api.items.upload(itemId, vars.file, vars),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, itemId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.itemUpdates(orgId, itemId) }),
      ]),
    onError: (error) => toastError(error, 'Upload failed'),
  });
}

export function useDeleteFile(itemId: string, boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => api.files.remove(fileId),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, itemId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) }),
      ]),
    onError: (error) => toastError(error, 'Could not delete the file'),
  });
}

export function useItemActivity(itemId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: queryKeys.itemActivity(orgId, itemId ?? ''),
    queryFn: ({ pageParam }) =>
      api.items.activity(itemId as string, { cursor: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<ActivityDto>) => last.nextCursor,
    enabled: Boolean(itemId),
  });
}

export function useBoardActivity(boardId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: queryKeys.boardActivity(orgId, boardId ?? ''),
    queryFn: ({ pageParam }) =>
      api.boards.activity(boardId as string, { cursor: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<ActivityDto>) => last.nextCursor,
    enabled: Boolean(boardId),
  });
}
