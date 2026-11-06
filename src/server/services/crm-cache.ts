/**
 * Tiny in-process cache for CRM read models (pipeline facts, duplicate candidates, board
 * resolution). Entries are keyed per org and guarded by a cheap *version stamp* (e.g. the
 * board's max(items.updated_at) + count), so a stale entry is never served after a write that
 * bumps the stamp; a short TTL bounds anything the stamp cannot see (comments, other boards).
 * CRM writes call `invalidateCrmCache(orgId)` for read-your-writes in this process.
 *
 * In-flight loads are shared, so N concurrent requests for the same key do the work once.
 */
import { and, count, eq, inArray, isNull, max } from 'drizzle-orm';
import { items } from '@/server/db/schema';
import type { ServiceContext } from './context';

interface Entry {
  readonly orgId: string;
  readonly version: string;
  readonly expiresAt: number;
  readonly value: Promise<unknown>;
}

const MAX_ENTRIES = 300;
const globalStore = globalThis as unknown as { __kitstakCrmCache?: Map<string, Entry> };
const store: Map<string, Entry> = (globalStore.__kitstakCrmCache ??= new Map());

function prune(now: number) {
  for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Return the cached value for `key` when its version matches and it has not expired, else run
 * `load` (once, shared by concurrent callers). Failed loads are evicted immediately.
 */
export async function cachedCrm<T>(
  orgId: string,
  key: string,
  version: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const fullKey = `${orgId}:${key}`;
  const hit = store.get(fullKey);
  if (hit && hit.version === version && hit.expiresAt > now) return hit.value as Promise<T>;
  const value = load();
  store.set(fullKey, { orgId, version, expiresAt: now + ttlMs, value });
  value.catch(() => {
    if (store.get(fullKey)?.value === value) store.delete(fullKey);
  });
  if (store.size > MAX_ENTRIES) prune(now);
  return value;
}

/** Drop every cached CRM read model of an org (called after CRM writes). */
export function invalidateCrmCache(orgId: string): void {
  for (const [key, entry] of store) if (entry.orgId === orgId) store.delete(key);
}

/** Cheap change stamp for a set of boards: live item count + latest item update. */
export async function boardsVersion(ctx: ServiceContext, boardIds: readonly (string | null | undefined)[]): Promise<string> {
  const ids = [...new Set(boardIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return 'none';
  const rows = await ctx.db
    .select({ boardId: items.boardId, total: count(), latest: max(items.updatedAt) })
    .from(items)
    .where(and(eq(items.orgId, ctx.orgId), inArray(items.boardId, ids), isNull(items.deletedAt)))
    .groupBy(items.boardId);
  return rows
    .map((row) => `${row.boardId}:${row.total}:${row.latest ? new Date(row.latest).getTime() : 0}`)
    .sort()
    .join('|');
}
