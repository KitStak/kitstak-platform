/**
 * Short-lived, in-process cache for dashboard insight datasets.
 *
 * A dashboard renders many widgets over the same boards. Without this, every widget reloads
 * every item, column and group of every connected board (and hydrates formula columns). The
 * cache shares one load per (org, user, boards, hydration) for a few seconds, and de-duplicates
 * concurrent loads so a dashboard's first paint triggers a single database round trip.
 *
 * Keyed by user because board visibility is per user. A hydrated dataset also satisfies a
 * non-hydrated request (it is a superset).
 */

const DEFAULT_TTL_MS = 10_000;
const MAX_ENTRIES = 64;

interface Entry<T> {
  readonly expiresAt: number;
  readonly promise: Promise<T>;
}

export interface DatasetCacheKey {
  readonly orgId: string;
  readonly userId: string | null;
  readonly boardIds: readonly string[];
  readonly hydrated: boolean;
}

export function datasetCacheKey(key: DatasetCacheKey): string {
  const boards = [...key.boardIds].sort().join(',');
  return `${key.orgId}|${key.userId ?? '-'}|${boards}|${key.hydrated ? 'h' : 'p'}`;
}

export class DatasetCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private live(key: string): Entry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Cached (or in-flight) value for the key, else run `load` once and share it. */
  get(key: DatasetCacheKey, load: () => Promise<T>, options: { fresh?: boolean } = {}): Promise<T> {
    const exact = datasetCacheKey(key);
    if (!options.fresh) {
      const hit = this.live(exact) ?? (key.hydrated ? undefined : this.live(datasetCacheKey({ ...key, hydrated: true })));
      if (hit) return hit.promise;
    }
    const promise = load();
    this.entries.set(exact, { expiresAt: this.now() + this.ttlMs, promise });
    // A failed load must not be served to the next caller.
    promise.catch(() => {
      if (this.entries.get(exact)?.promise === promise) this.entries.delete(exact);
    });
    this.evict();
    return promise;
  }

  /** Drop every entry for an org (e.g. after a write that changes widget sources). */
  invalidateOrg(orgId: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${orgId}|`)) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
