/**
 * Who may call the billing tick (docs/billing/CONTRACTS.md section 14). Kept apart from the route
 * so the rule can be unit tested without a server.
 *
 *   CRON_SECRET   NODE_ENV          request                              answer
 *   set           any               Authorization: Bearer <secret>       run
 *   set           any               anything else                        401
 *   not set       not production    any                                  run (local dev has no secret)
 *   not set       production        any                                  503 (the job is not set up)
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export type TickAuth = { readonly ok: true } | { readonly ok: false; readonly status: 401 | 503; readonly message: string };

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Compared as hashes in constant time, so the answer time tells nothing about the secret. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

export function authorizeTick(input: { cronSecret: string | undefined; nodeEnv: string; authorization: string | null }): TickAuth {
  const secret = input.cronSecret?.trim() ?? '';
  if (secret === '') {
    if (input.nodeEnv === 'production') {
      return { ok: false, status: 503, message: 'The billing job is not set up. Set CRON_SECRET.' };
    }
    return { ok: true };
  }
  const match = /^Bearer\s+(.+)$/i.exec(input.authorization?.trim() ?? '');
  if (!match || !sameSecret(match[1] ?? '', secret)) {
    return { ok: false, status: 401, message: 'Not allowed.' };
  }
  return { ok: true };
}
