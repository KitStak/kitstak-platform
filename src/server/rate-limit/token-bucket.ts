/**
 * In-memory token-bucket rate limiter.
 *
 * Per-process: correct for a single Node instance (local dev, single-container deploys).
 * For horizontally scaled deployments swap the store for a shared one (Redis) behind the
 * same `RateLimitStore` interface.
 */

export interface RateLimitPolicy {
  /** Max tokens (burst size). */
  readonly capacity: number;
  /** Tokens added per second. */
  readonly refillPerSecond: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Whole tokens left after this request. */
  readonly remaining: number;
  readonly limit: number;
  /** Seconds until at least one token is available (0 when allowed). */
  readonly retryAfterSeconds: number;
  /** Seconds until the bucket is full again. */
  readonly resetSeconds: number;
}

interface Bucket {
  readonly tokens: number;
  readonly updatedAt: number;
}

export interface RateLimitStore {
  get(key: string): Bucket | undefined;
  set(key: string, bucket: Bucket): void;
  delete(key: string): void;
  size(): number;
  entries(): IterableIterator<[string, Bucket]>;
}

class MapStore implements RateLimitStore {
  private readonly map = new Map<string, Bucket>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, bucket: Bucket) {
    this.map.set(key, bucket);
  }
  delete(key: string) {
    this.map.delete(key);
  }
  size() {
    return this.map.size;
  }
  entries() {
    return this.map.entries();
  }
}

export interface TokenBucketOptions {
  readonly store?: RateLimitStore;
  readonly now?: () => number;
  /** Max tracked keys before full/idle buckets are evicted. */
  readonly maxKeys?: number;
}

export class TokenBucketLimiter {
  private readonly store: RateLimitStore;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(options: TokenBucketOptions = {}) {
    this.store = options.store ?? new MapStore();
    this.now = options.now ?? (() => Date.now());
    this.maxKeys = options.maxKeys ?? 50_000;
  }

  /** Consume `cost` tokens for `key` under `policy`. */
  consume(key: string, policy: RateLimitPolicy, cost = 1): RateLimitDecision {
    if (policy.capacity <= 0 || policy.refillPerSecond <= 0) {
      throw new Error('Rate limit policy must have positive capacity and refill rate');
    }
    const now = this.now();
    const previous = this.store.get(key);
    const elapsedSeconds = previous ? Math.max(0, (now - previous.updatedAt) / 1000) : 0;
    const available = previous
      ? Math.min(policy.capacity, previous.tokens + elapsedSeconds * policy.refillPerSecond)
      : policy.capacity;

    const allowed = available >= cost;
    const tokens = allowed ? available - cost : available;
    this.store.set(key, { tokens, updatedAt: now });
    if (this.store.size() > this.maxKeys) this.evict(now, policy);

    const deficit = Math.max(0, cost - tokens);
    return {
      allowed,
      remaining: Math.floor(tokens),
      limit: policy.capacity,
      retryAfterSeconds: allowed ? 0 : deficit / policy.refillPerSecond,
      resetSeconds: (policy.capacity - tokens) / policy.refillPerSecond,
    };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  /** Drop buckets that would be full by now (they carry no state worth keeping). */
  private evict(now: number, policy: RateLimitPolicy): void {
    const fullAfterMs = (policy.capacity / policy.refillPerSecond) * 1000;
    for (const [key, bucket] of this.store.entries()) {
      if (now - bucket.updatedAt >= fullAfterMs) this.store.delete(key);
    }
  }
}
