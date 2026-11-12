/**
 * Optimistic "+ Add subitem": a pending row appears in the parent's subitem list at once, the
 * parent's count bumps, and both are swapped for (or rolled back from) the server result.
 */
import type { QueryClient } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import type { KitstakApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { patchItemInCaches, toastError } from '@/lib/hooks/cache';
import type { ItemDto } from '@/server/services/contracts/dto';

/** Placeholder subitem appended after the parent's current last subitem. */
export function tempSubitem(parent: ItemDto, name: string, siblings: readonly ItemDto[], now = new Date()): ItemDto {
  const last = [...siblings].map((item) => item.position).sort().at(-1) ?? null;
  let position: string;
  try {
    position = generateKeyBetween(last, null);
  } catch {
    position = `${last ?? 'a0'}z`;
  }
  const stamp = now.toISOString();
  return {
    id: `temp-${Math.random().toString(36).slice(2, 10)}`,
    boardId: parent.boardId,
    groupId: parent.groupId,
    parentItemId: parent.id,
    name,
    position,
    values: {},
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: stamp,
    updatedAt: stamp,
    archivedAt: null,
    deletedAt: null,
  } as ItemDto;
}

/** Replaces the temp row with the server row (or drops it when `next` is null). */
export function settleSubitem(
  list: readonly ItemDto[] | undefined,
  tempId: string,
  next: ItemDto | null,
): ItemDto[] | undefined {
  if (!list) return list;
  const out: ItemDto[] = [];
  for (const item of list) {
    if (item.id !== tempId) out.push(item);
    else if (next && !list.some((other) => other.id === next.id)) out.push(next);
  }
  return out;
}

export interface CreateSubitemDeps {
  readonly api: KitstakApi;
  readonly queryClient: QueryClient;
  readonly orgId: string;
  readonly boardId: string;
  readonly onCreated?: (item: ItemDto) => void;
}

export async function createSubitemOptimistic(
  deps: CreateSubitemDeps,
  parent: ItemDto,
  name: string,
): Promise<ItemDto | null> {
  const { api, queryClient, orgId, boardId } = deps;
  const key = queryKeys.subitems(orgId, parent.id);
  await queryClient.cancelQueries({ queryKey: key });
  const siblings = queryClient.getQueryData<ItemDto[]>(key) ?? [];
  const temp = tempSubitem(parent, name, siblings);
  queryClient.setQueryData<ItemDto[]>(key, (list) => [...(list ?? []), temp]);
  const bump = (delta: number) =>
    patchItemInCaches(queryClient, orgId, boardId, parent.id, (item) => ({
      ...item,
      subitemCount: Math.max(0, item.subitemCount + delta),
    }));
  bump(1);
  try {
    const created = await api.items.createSubitem(parent.id, { name, groupId: parent.groupId });
    queryClient.setQueryData<ItemDto[]>(key, (list) => settleSubitem(list, temp.id, created));
    deps.onCreated?.(created);
    return created;
  } catch (error) {
    queryClient.setQueryData<ItemDto[]>(key, (list) => settleSubitem(list, temp.id, null));
    bump(-1);
    toastError(error, 'Could not add the subitem');
    return null;
  }
}
