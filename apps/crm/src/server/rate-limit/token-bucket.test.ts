import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from './token-bucket';
import { checkRateLimit, enforceRateLimit, rateLimitHeaders, RATE_LIMIT_POLICIES } from './index';
import { RateLimitedError } from '@/server/http/errors';

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('TokenBucketLimiter', () => {
  const policy = { capacity: 3, refillPerSecond: 1 };

  it('allows bursts up to capacity then blocks', () => {
    const limiter = new TokenBucketLimiter({ now: clock().now });
    expect(limiter.consume('k', policy).remaining).toBe(2);
    limiter.consume('k', policy);
    expect(limiter.consume('k', policy).allowed).toBe(true);
    const blocked = limiter.consume('k', policy);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeCloseTo(1);
  });

  it('refills over time without exceeding capacity', () => {
    const time = clock();
    const limiter = new TokenBucketLimiter({ now: time.now });
    for (let i = 0; i < 3; i += 1) limiter.consume('k', policy);
    time.advance(1500);
    expect(limiter.consume('k', policy).allowed).toBe(true);
    time.advance(60_000);
    expect(limiter.consume('k', policy).remaining).toBe(2);
  });

  it('isolates keys and supports reset', () => {
    const limiter = new TokenBucketLimiter({ now: clock().now });
    for (let i = 0; i < 3; i += 1) limiter.consume('a', policy);
    expect(limiter.consume('a', policy).allowed).toBe(false);
    expect(limiter.consume('b', policy).allowed).toBe(true);
    limiter.reset('a');
    expect(limiter.consume('a', policy).allowed).toBe(true);
  });

  it('charges weighted costs', () => {
    const limiter = new TokenBucketLimiter({ now: clock().now });
    expect(limiter.consume('k', policy, 3).allowed).toBe(true);
    expect(limiter.consume('k', policy, 1).allowed).toBe(false);
  });

  it('evicts idle buckets when over the key budget', () => {
    const time = clock();
    const limiter = new TokenBucketLimiter({ now: time.now, maxKeys: 2 });
    limiter.consume('a', policy);
    limiter.consume('b', policy);
    time.advance(10_000);
    limiter.consume('c', policy);
    expect(limiter.consume('a', policy).remaining).toBe(2);
  });

  it('rejects invalid policies', () => {
    const limiter = new TokenBucketLimiter();
    expect(() => limiter.consume('k', { capacity: 0, refillPerSecond: 1 })).toThrow();
  });
});

describe('named policies', () => {
  it('throws RateLimitedError with Retry-After when exhausted', () => {
    const subject = `test-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_POLICIES.auth.capacity; i += 1) enforceRateLimit('auth', subject);
    expect(() => enforceRateLimit('auth', subject)).toThrow(RateLimitedError);
  });

  it('builds standard RateLimit headers', () => {
    const decision = checkRateLimit('default', `hdr-${Math.random()}`);
    expect(rateLimitHeaders(decision)).toMatchObject({
      'RateLimit-Limit': '600',
      'RateLimit-Remaining': '599',
    });
  });
});
