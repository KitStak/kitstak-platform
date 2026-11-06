'use client';

/**
 * Optimistic update (comment) mutations for the panel: post (with a pending placeholder),
 * edit, pin, and delete with a deferred commit so "Undo" truly restores the update.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { toastError, useApi, useOrgId } from '@/lib/hooks';
import { patchItemInCaches } from '@/lib/hooks/cache';
import { queryKeys } from '@/lib/query-keys';
import type { UpdateDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { RichDoc } from '../lib/rich-text';
import { docText, mentionIds } from '../lib/rich-text';

export const UNDO_WINDOW_MS = 6000;

type List = UpdateDto[] | undefined;

function mapAll(list: List, fn: (update: UpdateDto) => UpdateDto): List {
  return list?.map((thread) => ({ ...fn(thread), replies: thread.replies.map(fn) }));
}

function sortThreads(list: UpdateDto[]): UpdateDto[] {
  return [...list.filter((thread) => thread.pinned), ...list.filter((thread) => !thread.pinned)];
}

function insertUpdate(list: List, update: UpdateDto): List {
  if (!list) return list;
  if (update.parentUpdateId) {
    return list.map((thread) =>
      thread.id === update.parentUpdateId ? { ...thread, replies: [...thread.replies, update] } : thread,
    );
  }
  const pinned = list.filter((thread) => thread.pinned);
  return [...pinned, update, ...list.filter((thread) => !thread.pinned)];
}

function removeUpdate(list: List, updateId: string): List {
  return list
    ?.filter((thread) => thread.id !== updateId)
    .map((thread) => ({ ...thread, replies: thread.replies.filter((reply) => reply.id !== updateId) }));
}

function hasUpdate(list: List, id: string): boolean {
  return Boolean(list?.some((thread) => thread.id === id || thread.replies.some((reply) => reply.id === id)));
}

function replaceUpdate(list: List, id: string, next: UpdateDto): List {
  return list?.map((thread) =>
    thread.id === id
      ? { ...next, replies: thread.replies }
      : { ...thread, replies: thread.replies.map((reply) => (reply.id === id ? next : reply)) },
  );
}

export function tempUpdate(
  itemId: string,
  boardId: string,
  author: UserSummaryDto | null,
  body: RichDoc,
  parentUpdateId: string | null,
): UpdateDto {
  return {
    id: `temp-${Math.random().toString(36).slice(2, 10)}`,
    boardId,
    itemId,
    parentUpdateId,
    author,
    body: body as UpdateDto['body'],
    bodyText: docText(body),
    mentionedUserIds: mentionIds(body),
    pinned: false,
    editedAt: null,
    createdAt: new Date().toISOString(),
    reactions: [],
    readByMe: true,
    readCount: 0,
    files: [],
    replies: [],
  };
}

function bumpCount(queryClient: QueryClient, orgId: string, boardId: string, itemId: string, delta: number) {
  patchItemInCaches(queryClient, orgId, boardId, itemId, (item) => ({
    ...item,
    updateCount: Math.max(0, item.updateCount + delta),
  }));
}

export function useUpdateMutations(itemId: string, boardId: string, me: UserSummaryDto | null) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = queryKeys.itemUpdates(orgId, itemId);
  const setList = useCallback((fn: (list: List) => List) => queryClient.setQueryData<UpdateDto[]>(key, fn), [key, queryClient]);

  const create = useMutation({
    mutationFn: (vars: { body: RichDoc; parentUpdateId?: string; temp: UpdateDto }) =>
      api.updates.create(itemId, {
        body: vars.body as UpdateDto['body'] & { content?: unknown[] },
        parentUpdateId: vars.parentUpdateId,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      setList((list) => insertUpdate(list ?? [], vars.temp));
      if (!vars.parentUpdateId) bumpCount(queryClient, orgId, boardId, itemId, 1);
    },
    onError: (error, vars) => {
      setList((list) => removeUpdate(list, vars.temp.id));
      if (!vars.parentUpdateId) bumpCount(queryClient, orgId, boardId, itemId, -1);
      toastError(error, 'Could not post the update');
    },
    onSuccess: (update, vars) =>
      setList((list) => {
        const next = { ...update, replies: [] };
        // A realtime refetch may already have swapped the optimistic row for the stored one
        // (or dropped it): replace when present, otherwise insert unless it already arrived.
        if (hasUpdate(list, vars.temp.id)) return replaceUpdate(list, vars.temp.id, next);
        return hasUpdate(list, update.id) ? list : insertUpdate(list ?? [], next);
      }),
  });

  const edit = useMutation({
    mutationFn: (vars: { update: UpdateDto; body: RichDoc }) =>
      api.updates.edit(vars.update.id, { body: vars.body as UpdateDto['body'] & { content?: unknown[] } }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const saved = queryClient.getQueryData<UpdateDto[]>(key);
      setList((list) =>
        mapAll(list, (update) =>
          update.id === vars.update.id
            ? { ...update, body: vars.body as UpdateDto['body'], bodyText: docText(vars.body), editedAt: new Date().toISOString() }
            : update,
        ),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not save your edit');
    },
    onSuccess: (update) => setList((list) => replaceUpdate(list, update.id, update)),
  });

  const pin = useMutation({
    mutationFn: (vars: { updateId: string; pinned: boolean }) => api.updates.pin(vars.updateId, vars.pinned),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const saved = queryClient.getQueryData<UpdateDto[]>(key);
      setList((list) =>
        list ? sortThreads(list.map((thread) => (thread.id === vars.updateId ? { ...thread, pinned: vars.pinned } : thread))) : list,
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not pin the update');
    },
    onSuccess: (_update, vars) => toast.success(vars.pinned ? 'Pinned to top' : 'Unpinned'),
  });

  // Deferred delete: hidden immediately, committed after the Undo window (or on unmount).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>());

  const commitDelete = useCallback(
    (update: UpdateDto) => {
      timers.current.delete(update.id);
      api.updates
        .remove(update.id)
        .then(() => {
          setList((list) => removeUpdate(list, update.id));
          if (!update.parentUpdateId) bumpCount(queryClient, orgId, boardId, itemId, -1);
        })
        .catch((error: unknown) => toastError(error, 'Could not delete the update'))
        .finally(() =>
          setHidden((current) => {
            const next = new Set(current);
            next.delete(update.id);
            return next;
          }),
        );
    },
    [api, boardId, itemId, orgId, queryClient, setList],
  );

  const remove = useCallback(
    (update: UpdateDto) => {
      setHidden((current) => new Set(current).add(update.id));
      const commit = () => commitDelete(update);
      const timer = setTimeout(commit, UNDO_WINDOW_MS);
      timers.current.set(update.id, { timer, commit });
      toast.undo(update.parentUpdateId ? 'Reply deleted' : 'Update deleted', {
        duration: UNDO_WINDOW_MS,
        onUndo: () => {
          const pending = timers.current.get(update.id);
          if (pending) clearTimeout(pending.timer);
          timers.current.delete(update.id);
          setHidden((current) => {
            const next = new Set(current);
            next.delete(update.id);
            return next;
          });
        },
      });
    },
    [commitDelete],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const { timer, commit } of pending.values()) {
        clearTimeout(timer);
        commit();
      }
      pending.clear();
    };
  }, []);

  const post = useCallback(
    (body: RichDoc, parentUpdateId?: string) => {
      const temp = tempUpdate(itemId, boardId, me, body, parentUpdateId ?? null);
      return create.mutateAsync({ body, parentUpdateId, temp });
    },
    [boardId, create, itemId, me],
  );

  return { post, posting: create.isPending, edit, pin, remove, hidden };
}
