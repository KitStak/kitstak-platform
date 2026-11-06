/**
 * Cache helpers for optimistic updates. Items can live in three places at once — the board
 * payload, infinite item pages and the item detail — so mutations patch all of them through
 * these helpers and roll back from a snapshot on failure.
 */
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiClientError, type Paginated } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { BoardPayloadDto, ItemDetailDto, ItemDto } from '@/server/services/contracts/dto';

export type Snapshot = ReadonlyArray<readonly [QueryKey, unknown]>;

/** Cancel in-flight fetches and capture the current data under `prefix`. */
export async function snapshot(queryClient: QueryClient, prefix: QueryKey): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: prefix });
  return queryClient.getQueriesData({ queryKey: prefix });
}

/**
 * Latency-first optimistic update: capture every query under `prefix` and write
 * `transform(saved)` in the same tick as the click, then cancel in-flight fetches and write it
 * again (a cancelled fetch reverts its query to the pre-fetch data, which would drop the patch).
 * Because the transform always starts from the captured data, deltas are applied exactly once.
 */
export async function patchOptimistically<T>(
  queryClient: QueryClient,
  prefix: QueryKey,
  transform: (data: T, key: QueryKey) => T,
): Promise<Snapshot> {
  const saved = queryClient.getQueriesData<T>({ queryKey: prefix });
  const apply = () => {
    for (const [key, data] of saved) {
      if (data !== undefined) queryClient.setQueryData<T>(key, transform(data, key));
    }
  };
  apply();
  await queryClient.cancelQueries({ queryKey: prefix });
  apply();
  return saved;
}

export function restore(queryClient: QueryClient, saved: Snapshot | undefined): void {
  if (!saved) return;
  for (const [key, data] of saved) queryClient.setQueryData(key, data);
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiClientError) {
    const issues = (error.details as { issues?: { message: string }[] } | undefined)?.issues;
    if (error.code === 'VALIDATION_FAILED' && issues?.[0]) return issues[0].message;
    return error.message;
  }
  return fallback;
}

export function toastError(error: unknown, title: string): void {
  toast.error(title, { description: errorMessage(error) });
}

type ItemUpdater = (item: ItemDto) => ItemDto | null;

function patchList(list: readonly ItemDto[], itemId: string, updater: ItemUpdater): ItemDto[] {
  const out: ItemDto[] = [];
  for (const item of list) {
    if (item.id !== itemId) {
      out.push(item);
      continue;
    }
    const next = updater(item);
    if (next) out.push(next);
  }
  return out;
}

/** Apply `updater` to an item wherever it is cached for this board (null removes it). */
export function patchItemInCaches(
  queryClient: QueryClient,
  orgId: string,
  boardId: string,
  itemId: string,
  updater: ItemUpdater,
): void {
  queryClient.setQueryData<BoardPayloadDto>(queryKeys.boardPayload(orgId, boardId), (payload) =>
    payload ? { ...payload, items: patchList(payload.items, itemId, updater) } : payload,
  );
  queryClient.setQueriesData<InfiniteData<Paginated<ItemDto>>>(
    { queryKey: ['org', orgId, 'board', boardId, 'items'] },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({ ...page, items: patchList(page.items, itemId, updater) })),
          }
        : data,
  );
  queryClient.setQueryData<ItemDetailDto>(queryKeys.itemDetail(orgId, itemId), (detail) => {
    if (!detail) return detail;
    const next = updater(detail.item);
    return next ? { ...detail, item: next } : detail;
  });
  // Subitem lists of any parent.
  queryClient.setQueriesData<ItemDto[]>(
    { queryKey: ['org', orgId, 'item'], predicate: (query) => query.queryKey[4] === 'subitems' },
    (list) => (Array.isArray(list) ? patchList(list, itemId, updater) : list),
  );
}

/** Insert or replace an item in the board payload (keeps display order by group + position). */
export function upsertItemInPayload(
  queryClient: QueryClient,
  orgId: string,
  boardId: string,
  item: ItemDto,
  replaceId?: string,
): void {
  queryClient.setQueryData<BoardPayloadDto>(queryKeys.boardPayload(orgId, boardId), (payload) => {
    if (!payload) return payload;
    const groupOrder = new Map(payload.groups.map((group, index) => [group.id, index]));
    const rest = payload.items.filter((entry) => entry.id !== item.id && entry.id !== replaceId);
    const items = [...rest, item].sort(
      (a, b) =>
        (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) ||
        (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
    );
    const added = rest.length === payload.items.length ? 1 : 0;
    return { ...payload, items, totalItems: payload.totalItems + added };
  });
}

export function removeItemsFromPayload(
  queryClient: QueryClient,
  orgId: string,
  boardId: string,
  itemIds: readonly string[],
): void {
  const ids = new Set(itemIds);
  queryClient.setQueryData<BoardPayloadDto>(queryKeys.boardPayload(orgId, boardId), (payload) => {
    if (!payload) return payload;
    const items = payload.items.filter((item) => !ids.has(item.id));
    return {
      ...payload,
      items,
      totalItems: Math.max(0, payload.totalItems - (payload.items.length - items.length)),
    };
  });
  queryClient.setQueriesData<InfiniteData<Paginated<ItemDto>>>(
    { queryKey: ['org', orgId, 'board', boardId, 'items'] },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => !ids.has(item.id)),
            })),
          }
        : data,
  );
}

/** Find an item's board id from the caches (for mutations that only know the item id). */
export function findCachedItem(queryClient: QueryClient, orgId: string, itemId: string): ItemDto | undefined {
  const detail = queryClient.getQueryData<ItemDetailDto>(queryKeys.itemDetail(orgId, itemId));
  if (detail) return detail.item;
  for (const [, payload] of queryClient.getQueriesData<BoardPayloadDto>({
    queryKey: ['org', orgId, 'board'],
  })) {
    const hit = (payload as BoardPayloadDto | undefined)?.items?.find?.((item) => item.id === itemId);
    if (hit) return hit;
  }
  return undefined;
}
