'use client';
/**
 * Data layer for My work and the Inbox feed. Mutations are optimistic with rollback + toast.
 * Keys live under `['org', orgId, 'my-work' | 'inbox']`; the notifications realtime stream
 * refreshes the inbox prefix when new activity arrives.
 */
import { useCallback } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { apiRequest, apiRequestWithMeta } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { patchOptimistically, restore, toastError } from '@/lib/hooks/cache';
import { useOrgId } from '@/lib/hooks/org-context';
import type { ItemDto, ReactionDto, UpdateDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type {
  InboxBoardOptionDto,
  InboxFilter,
  InboxThreadDto,
  MyWorkDto,
} from '@/server/services/contracts/inbox-mywork';
import { patchMyWorkItem } from './my-work-model';
import { plainTextToDoc } from './inbox-model';

export const myWorkKey = (orgId: string) => ['org', orgId, 'my-work'] as const;
export const inboxRoot = (orgId: string) => ['org', orgId, 'inbox'] as const;
const inboxFeedKey = (orgId: string, params: InboxParams) =>
  [...inboxRoot(orgId), 'feed', { filter: params.filter, boardId: params.boardId ?? null }] as const;
const inboxBoardsKey = (orgId: string) => [...inboxRoot(orgId), 'boards'] as const;

// ---------------------------------------------------------------------------------------------
// My work
// ---------------------------------------------------------------------------------------------

/**
 * Status writes that wait out their Undo window before reaching the server (so an undone
 * "done"/"won" never fires automations or notifications). Keyed by item id; applied on top of
 * every My work fetch so a refetch inside the window does not resurrect the old value.
 */
interface PendingCellWrite {
  readonly vars: SetCellVars;
  readonly orgId: string;
  readonly commit: () => void;
}
const pendingCellWrites = new Map<string, PendingCellWrite>();

function applyPendingWrites(data: MyWorkDto): MyWorkDto {
  let out = data;
  for (const [itemId, pending] of pendingCellWrites) out = patchMyWorkItem(out, itemId, pending.vars.patch);
  return out;
}

function putCell(orgId: string, vars: SetCellVars, keepalive = true): Promise<ItemDto> {
  return apiRequest<ItemDto>(`/items/${vars.itemId}/values`, {
    orgId,
    method: 'PUT',
    body: { columnKey: vars.columnKey, value: vars.value },
    // Survives a reload / tab close right after the click.
    keepalive,
  });
}

/** Tab closing: send every deferred write now (keepalive outlives the page). */
function flushPendingCellWrites(): void {
  for (const pending of [...pendingCellWrites.values()]) pending.commit();
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPendingCellWrites);

export function useMyWork() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: myWorkKey(orgId),
    queryFn: async ({ signal }) => applyPendingWrites(await apiRequest<MyWorkDto>('/my-work', { orgId, signal })),
    staleTime: 30_000,
  });
}

export interface SetCellVars {
  readonly itemId: string;
  readonly boardId: string;
  readonly columnKey: string;
  /** Stored cell value (`{ labelId }`, `{ date }`) or null to clear. */
  readonly value: unknown;
  /** Matching optimistic patch for the My work payload. */
  readonly patch: { statusLabelId?: string | null; date?: string | null };
}

export const myWorkCellKey = (orgId: string) => ['org', orgId, 'my-work', 'cell-write'] as const;

/** Optimistic inline edit of a status/date cell from My work. */
export function useMyWorkCell() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: myWorkCellKey(orgId),
    scope: { id: `my-work-cells-${orgId}` },
    mutationFn: (vars: SetCellVars) => putCell(orgId, vars),
    onMutate: async (vars) => {
      const saved = await patchOptimistically<MyWorkDto>(queryClient, myWorkKey(orgId), (data) =>
        patchMyWorkItem(data, vars.itemId, vars.patch),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not save the change');
    },
    onSuccess: (_item, vars) => {
      // Keep any open board / item panel caches in sync.
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, vars.boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.item(orgId, vars.itemId) });
    },
  });
}

/** Undo window for a status change that removes the row (matches the toast). */
export const DEFERRED_WRITE_MS = 6000;

/**
 * Show a cell change now and write it when the Undo window closes (or the tab hides).
 * `cancel()` (Undo) drops the write entirely and puts the previous value back locally, so the
 * server never sees the change. Returns false from `cancel` when the write already went out.
 */
export function useDeferredMyWorkCell() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useCallback(
    (vars: SetCellVars, revert: SetCellVars['patch'], delayMs = DEFERRED_WRITE_MS) => {
      // A newer deferred change for the same item replaces the older one (sent first).
      pendingCellWrites.get(vars.itemId)?.commit();
      queryClient.setQueryData<MyWorkDto>(myWorkKey(orgId), (data) =>
        data ? patchMyWorkItem(data, vars.itemId, vars.patch) : data,
      );
      let timer: ReturnType<typeof setTimeout> | null = null;
      const commit = () => {
        if (pendingCellWrites.get(vars.itemId)?.commit !== commit) return;
        pendingCellWrites.delete(vars.itemId);
        if (timer) clearTimeout(timer);
        putCell(orgId, vars)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.board(orgId, vars.boardId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.item(orgId, vars.itemId) });
          })
          .catch((error: unknown) => {
            queryClient.setQueryData<MyWorkDto>(myWorkKey(orgId), (data) =>
              data ? patchMyWorkItem(data, vars.itemId, revert) : data,
            );
            toastError(error, 'Could not save the change');
          });
      };
      pendingCellWrites.set(vars.itemId, { vars, orgId, commit });
      timer = setTimeout(commit, delayMs);
      return {
        cancel: (): boolean => {
          if (pendingCellWrites.get(vars.itemId)?.commit !== commit) return false;
          pendingCellWrites.delete(vars.itemId);
          if (timer) clearTimeout(timer);
          queryClient.setQueryData<MyWorkDto>(myWorkKey(orgId), (data) =>
            data ? patchMyWorkItem(data, vars.itemId, revert) : data,
          );
          return true;
        },
      };
    },
    [orgId, queryClient],
  );
}

/** Whether a My work write is queued or in flight (drives the beforeunload guard). */
export function hasPendingMyWorkWrites(): boolean {
  return pendingCellWrites.size > 0;
}

// ---------------------------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------------------------

export interface InboxParams {
  readonly filter: InboxFilter;
  readonly boardId?: string;
}

export interface InboxPage {
  readonly items: InboxThreadDto[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
}

type InboxData = InfiniteData<InboxPage, string | null>;

export function useInboxFeed(params: InboxParams) {
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: inboxFeedKey(orgId, params),
    queryFn: async ({ pageParam, signal }): Promise<InboxPage> => {
      const { data, meta } = await apiRequestWithMeta<InboxThreadDto[]>('/inbox', {
        orgId,
        signal,
        query: { limit: 15, filter: params.filter, boardId: params.boardId, cursor: pageParam ?? undefined },
      });
      return {
        items: data,
        nextCursor: (meta?.nextCursor as string | null | undefined) ?? null,
        unreadCount: typeof meta?.unreadCount === 'number' ? meta.unreadCount : 0,
      };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Keep the previous filter's cards on screen (dimmed) while the next filter loads.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useInboxBoards() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: inboxBoardsKey(orgId),
    queryFn: ({ signal }) => apiRequest<InboxBoardOptionDto[]>('/inbox/boards', { orgId, signal }),
    staleTime: 60_000,
  });
}

function isInboxData(data: unknown): data is InboxData {
  return typeof data === 'object' && data !== null && Array.isArray((data as InboxData).pages);
}

/** Pure transform of every cached feed page (other inbox keys pass through untouched). */
function mapFeed(
  patch: (thread: InboxThreadDto) => InboxThreadDto,
  unreadDelta = 0,
): (data: unknown) => unknown {
  return (data) =>
    isInboxData(data)
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map(patch),
            unreadCount: Math.max(0, page.unreadCount + unreadDelta),
          })),
        }
      : data;
}

/** Apply a feed transform optimistically to all inbox caches; returns the rollback snapshot. */
function patchFeed(
  queryClient: QueryClient,
  orgId: string,
  patch: (thread: InboxThreadDto) => InboxThreadDto,
  unreadDelta = 0,
) {
  return patchOptimistically<unknown>(queryClient, inboxRoot(orgId), mapFeed(patch, unreadDelta));
}

/** Non-optimistic in-place patch (server reconciliation after success). */
function patchThreads(
  queryClient: QueryClient,
  orgId: string,
  patch: (thread: InboxThreadDto) => InboxThreadDto,
): void {
  queryClient.setQueriesData<InboxData>(
    { queryKey: [...inboxRoot(orgId), 'feed'] },
    (data) => mapFeed(patch)(data) as InboxData | undefined,
  );
}

/** Ids a "mark read" must cover: the thread and every reply. */
export function threadUpdateIds(thread: InboxThreadDto): string[] {
  return [thread.update.id, ...thread.update.replies.map((reply) => reply.id)];
}

export function useInboxMarkRead() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: `inbox-read-${orgId}` },
    mutationFn: (vars: { thread: InboxThreadDto; read: boolean }) =>
      apiRequest<{ updated: number }>('/inbox/read', {
        orgId,
        method: 'POST',
        body: { updateIds: threadUpdateIds(vars.thread), read: vars.read },
      }),
    onMutate: async (vars) => {
      const setRead = (update: UpdateDto): UpdateDto => ({ ...update, readByMe: vars.read });
      const delta = vars.thread.unread === vars.read ? (vars.read ? -1 : 1) : 0;
      const saved = await patchFeed(
        queryClient,
        orgId,
        (thread) =>
          thread.update.id === vars.thread.update.id
            ? {
                ...thread,
                unread: !vars.read,
                update: { ...setRead(thread.update), replies: thread.update.replies.map(setRead) },
              }
            : thread,
        delta,
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not update read state');
    },
  });
}

function toggleReaction(update: UpdateDto, emoji: string, userId: string): UpdateDto {
  const existing = update.reactions.find((reaction) => reaction.emoji === emoji);
  let reactions: ReactionDto[];
  if (!existing) reactions = [...update.reactions, { emoji, count: 1, userIds: [userId], reactedByMe: true }];
  else
    reactions = update.reactions
      .map((reaction) =>
        reaction.emoji !== emoji
          ? reaction
          : reaction.reactedByMe
            ? {
                ...reaction,
                count: reaction.count - 1,
                reactedByMe: false,
                userIds: reaction.userIds.filter((id) => id !== userId),
              }
            : {
                ...reaction,
                count: reaction.count + 1,
                reactedByMe: true,
                userIds: [...reaction.userIds, userId],
              },
      )
      .filter((reaction) => reaction.count > 0);
  return { ...update, reactions };
}

function mapUpdate(
  thread: InboxThreadDto,
  updateId: string,
  fn: (update: UpdateDto) => UpdateDto,
): InboxThreadDto {
  if (thread.update.id === updateId)
    return { ...thread, update: { ...fn(thread.update), replies: thread.update.replies } };
  if (!thread.update.replies.some((reply) => reply.id === updateId)) return thread;
  return {
    ...thread,
    update: {
      ...thread.update,
      replies: thread.update.replies.map((reply) => (reply.id === updateId ? fn(reply) : reply)),
    },
  };
}

export const LIKE_EMOJI = '👍';

export function useInboxLike(currentUserId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: `inbox-like-${orgId}` },
    mutationFn: (vars: { updateId: string; itemId: string }) =>
      apiRequest<UpdateDto>(`/updates/${vars.updateId}/reactions`, {
        orgId,
        method: 'POST',
        body: { emoji: LIKE_EMOJI },
      }),
    onMutate: async (vars) => {
      const saved = await patchFeed(queryClient, orgId, (thread) =>
        mapUpdate(thread, vars.updateId, (update) => toggleReaction(update, LIKE_EMOJI, currentUserId)),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not like the update');
    },
    onSuccess: (_update, vars) =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.itemUpdates(orgId, vars.itemId) }),
  });
}

export interface ReplyVars {
  readonly thread: InboxThreadDto;
  /** Rich body from the reply editor (mentions, formatting); plain text is the fallback. */
  readonly body?: { readonly type: 'doc'; readonly content?: readonly unknown[] };
  readonly text: string;
  readonly tempId: string;
}

/** Inline reply. Appends an optimistic reply; replaced by the server copy on success. */
export function useInboxReply(currentUser: UserSummaryDto) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: ReplyVars) =>
      apiRequest<UpdateDto>(`/items/${vars.thread.itemId}/updates`, {
        orgId,
        method: 'POST',
        body: { body: vars.body ?? plainTextToDoc(vars.text), parentUpdateId: vars.thread.update.id },
      }),
    onMutate: async (vars) => {
      const optimistic: UpdateDto = {
        id: vars.tempId,
        boardId: vars.thread.boardId,
        itemId: vars.thread.itemId,
        parentUpdateId: vars.thread.update.id,
        author: currentUser,
        body: (vars.body ?? plainTextToDoc(vars.text)) as UpdateDto['body'],
        bodyText: vars.text,
        mentionedUserIds: [],
        pinned: false,
        editedAt: null,
        createdAt: new Date().toISOString(),
        reactions: [],
        readByMe: true,
        readCount: 0,
        files: [],
        replies: [],
      };
      const saved = await patchFeed(queryClient, orgId, (thread) =>
        thread.update.id === vars.thread.update.id
          ? { ...thread, update: { ...thread.update, replies: [...thread.update.replies, optimistic] } }
          : thread,
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not send your reply');
    },
    onSuccess: (reply, vars) => {
      patchThreads(queryClient, orgId, (thread) => mapUpdate(thread, vars.tempId, () => reply));
      void queryClient.invalidateQueries({ queryKey: queryKeys.itemUpdates(orgId, vars.thread.itemId) });
    },
  });
}
