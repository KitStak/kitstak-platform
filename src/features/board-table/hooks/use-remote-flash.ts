'use client';

/**
 * Highlights rows / cells changed by someone else. Compares each refresh of the item list
 * with the previous one; changes we made ourselves (see TableActions.isLocalChange) are
 * skipped. Flashes clear after 700ms (the CSS animation runs 600ms).
 */
import { useEffect, useRef } from 'react';
import type { ItemDto } from '@/server/services/contracts/dto';
import type { TableStore } from '../state/table-store';

const FLASH_MS = 700;
export const ROW_FLASH = '*';

/** Column keys that differ between two versions of an item ("name" for the name). */
export function changedKeys(before: ItemDto, after: ItemDto): string[] {
  const keys: string[] = [];
  if (before.name !== after.name) keys.push('name');
  const all = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
  for (const key of all) {
    if (JSON.stringify(before.values[key]) !== JSON.stringify(after.values[key])) keys.push(key);
  }
  return keys;
}

/** More changes than this in one refresh is a bulk reload (import, page load), not a colleague's edit. */
const MAX_FLASHES = 40;

/** Remote changes between two snapshots: item id → changed keys. Pure. */
export function remoteChanges(
  prev: ReadonlyMap<string, ItemDto>,
  items: readonly ItemDto[],
  isLocalChange: (itemId: string) => boolean,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // A placeholder row was just swapped for the server row: that new id is ours.
  let hadTemp = false;
  for (const id of prev.keys()) if (id.startsWith('temp-')) hadTemp = true;
  for (const item of items) {
    if (item.id.startsWith('temp-') || isLocalChange(item.id)) continue;
    const old = prev.get(item.id);
    let keys: string[];
    if (!old) keys = prev.size > 0 && !hadTemp ? [ROW_FLASH] : [];
    else if (old.updatedAt === item.updatedAt) continue;
    else keys = changedKeys(old, item);
    if (keys.length) out.set(item.id, keys);
    if (out.size > MAX_FLASHES) return new Map();
  }
  return out;
}

export function useRemoteFlash(
  items: readonly ItemDto[],
  store: TableStore,
  isLocalChange: (itemId: string) => boolean,
  enabled = true,
): void {
  const previous = useRef<Map<string, ItemDto> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = new Map(items.map((item) => [item.id, item]));
    if (!prev || !enabled) return;
    const changes = remoteChanges(prev, items, isLocalChange);
    if (!changes.size) return;
    store.getState().setFlashes(Object.fromEntries(changes));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      store.getState().setFlashes({});
    }, FLASH_MS);
  }, [enabled, isLocalChange, items, store]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
