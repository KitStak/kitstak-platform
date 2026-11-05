/**
 * In-memory sliding-window rate limiter.
 * Suitable for a single-process deployment (dev / demo); swap for Redis in a cluster.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

interface Bucket {
  timestamps: readonly number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Record an attempt for `key` and report whether it is within the limit. */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const previous = buckets.get(key)?.timestamps ?? [];
  const recent = previous.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_ATTEMPTS) {
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    buckets.set(key, { timestamps: recent });
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  const updated = [...recent, now];
  buckets.set(key, { timestamps: updated });

  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 1000) {
    for (const [k, bucket] of buckets) {
      const last = bucket.timestamps[bucket.timestamps.length - 1];
      if (last === undefined || now - last >= WINDOW_MS) {
        buckets.delete(k);
      }
    }
  }

  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - updated.length,
    retryAfterSeconds: 0,
  };
}
