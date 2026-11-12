/** Prev/next navigation over the board's top-level items in display order (group, then position). */
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';

export function orderedItemIds(items: readonly ItemDto[], groups: readonly GroupDto[]): string[] {
  const groupOrder = new Map(groups.map((group, index) => [group.id, index]));
  return items
    .filter((item) => item.parentItemId === null && !item.id.startsWith('temp-'))
    .slice()
    .sort(
      (a, b) =>
        (groupOrder.get(a.groupId) ?? Number.MAX_SAFE_INTEGER) - (groupOrder.get(b.groupId) ?? Number.MAX_SAFE_INTEGER) ||
        (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
    )
    .map((item) => item.id);
}

export interface Neighbors {
  readonly prevId: string | null;
  readonly nextId: string | null;
  /** 1-based position, 0 when the item is not in the list. */
  readonly index: number;
  readonly total: number;
}

export function neighbors(ids: readonly string[], itemId: string): Neighbors {
  const index = ids.indexOf(itemId);
  if (index < 0) return { prevId: null, nextId: null, index: 0, total: ids.length };
  return {
    prevId: index > 0 ? (ids[index - 1] ?? null) : null,
    nextId: index < ids.length - 1 ? (ids[index + 1] ?? null) : null,
    index: index + 1,
    total: ids.length,
  };
}
