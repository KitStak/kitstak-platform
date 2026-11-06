/**
 * Named rate-limit policies used by `withApi({ rateLimit })`.
 * Keys combine the policy name with the user id (or client IP when anonymous).
 */
import { RateLimitedError } from '@/server/http/errors';
import { type RateLimitDecision, type RateLimitPolicy, TokenBucketLimiter } from './token-bucket';

export const RATE_LIMIT_POLICIES = {
  /** Normal reads. 600 burst, 10/s sustained. */
  default: { capacity: 600, refillPerSecond: 10 },
  /** Mutations. 120 burst, 2/s sustained. */
  mutation: { capacity: 120, refillPerSecond: 2 },
  /** Bulk / expensive operations (import, export, bulk edit). */
  heavy: { capacity: 10, refillPerSecond: 10 / 60 },
  /** Auth-sensitive endpoints (password, tokens, invites). */
  auth: { capacity: 10, refillPerSecond: 10 / 60 },
  /** Search / typeahead. */
  search: { capacity: 120, refillPerSecond: 5 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

interface LimiterGlobal {
  __kitstakRateLimiter?: TokenBucketLimiter;
}

const slot = globalThis as typeof globalThis & LimiterGlobal;

export function getLimiter(): TokenBucketLimiter {
  slot.__kitstakRateLimiter ??= new TokenBucketLimiter();
  return slot.__kitstakRateLimiter;
}

export function checkRateLimit(
  policyName: RateLimitPolicyName,
  subject: string,
  cost = 1,
): RateLimitDecision {
  return getLimiter().consume(`${policyName}:${subject}`, RATE_LIMIT_POLICIES[policyName], cost);
}

/** Throws `RateLimitedError` when the subject is over the policy limit. */
export function enforceRateLimit(
  policyName: RateLimitPolicyName,
  subject: string,
  cost = 1,
): RateLimitDecision {
  const decision = checkRateLimit(policyName, subject, cost);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  return decision;
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(Math.max(0, decision.remaining)),
    'RateLimit-Reset': String(Math.ceil(decision.resetSeconds)),
  };
}

export { TokenBucketLimiter, type RateLimitDecision, type RateLimitPolicy } from './token-bucket';
