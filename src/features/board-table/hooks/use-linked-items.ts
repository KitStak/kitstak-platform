'use client';

/**
 * Names for connect_boards cells, resolved by id. The cells module resolves at most the first
 * 500 linked ids of a board; the table can hold thousands of items, so this hook fetches every
 * id the loaded items reference (in display order, so the first screen resolves first) in
 * small batches through the same light `/cells/linked-items` endpoint, and accumulates names.
 * A failed batch marks its ids as settled: those cells show "Item unavailable" instead of an
 * endless skeleton, and `retry()` asks again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useOrgId } from '@/lib/hooks';
import type { ConnectCandidate } from '@/features/cells';
import type { ItemDto } from '@/server/services/contracts/dto';

/** Ids per request: small enough that the first screen of names lands quickly. */
export const LINKED_BATCH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Linked item ids referenced by the items, first-seen order, deduplicated. */
export function linkedIdsInOrder(items: readonly Pick<ItemDto, 'values'>[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const value of Object.values(item.values ?? {}) as unknown[]) {
      if (!value || typeof value !== 'object') continue;
      const ids = (value as { itemIds?: unknown }).itemIds;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) if (typeof id === 'string' && UUID_RE.test(id)) seen.add(id);
    }
  }
  return [...seen];
}

/** Splits the ids nobody asked for yet into request batches. */
export function pendingBatches(
  ids: readonly string[],
  settled: ReadonlySet<string>,
  size = LINKED_BATCH,
): string[][] {
  const todo = ids.filter((id) => !settled.has(id));
  const out: string[][] = [];
  for (let start = 0; start < todo.length; start += size) out.push(todo.slice(start, start + size));
  return out;
}

export interface LinkedItemsState {
  readonly linkedItems: ReadonlyMap<string, ConnectCandidate>;
  /** True while some referenced id is still being resolved. */
  readonly loading: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
}

export function useLinkedItems(items: readonly ItemDto[]): LinkedItemsState {
  const orgId = useOrgId();
  const ids = useMemo(() => linkedIdsInOrder(items), [items]);
  const [names, setNames] = useState<ReadonlyMap<string, ConnectCandidate>>(() => new Map());
  /** Ids the server answered for (found or not) or whose batch failed. */
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const batches = pendingBatches(ids, requested.current);
    if (!batches.length) return;
    for (const batch of batches) {
      for (const id of batch) requested.current.add(id);
      apiRequest<ConnectCandidate[]>('/cells/linked-items', {
        orgId,
        method: 'POST',
        body: { itemIds: batch },
      })
        .then((found) => {
          if (!found.length) return;
          setNames((current) => {
            const next = new Map(current);
            for (const entry of found) next.set(entry.id, entry);
            return next;
          });
        })
        .catch(() => {
          setFailedIds((current) => new Set([...current, ...batch]));
        })
        .finally(() => setSettled((current) => new Set([...current, ...batch])));
    }
  }, [ids, orgId, attempt]);

  const retry = useCallback(() => {
    for (const id of failedIds) requested.current.delete(id);
    setSettled((current) => new Set([...current].filter((id) => !failedIds.has(id))));
    setFailedIds(new Set());
    setAttempt((count) => count + 1);
  }, [failedIds]);

  const loading = useMemo(() => ids.some((id) => !settled.has(id)), [ids, settled]);
  return { linkedItems: names, loading, failed: failedIds.size > 0, retry };
}
