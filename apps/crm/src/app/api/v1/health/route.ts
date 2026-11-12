import { createHash, timingSafeEqual } from 'node:crypto';
import { withApi, apiResult } from '@/server/api';
import { pingDatabase } from '@/server/db';
import { env } from '@/server/env';
import { ServiceUnavailableError } from '@/server/http/errors';

const startedAt = Date.now();
const HEALTH_TOKEN_HEADER = 'x-health-token';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Version, uptime and latency are reconnaissance data: the public response is only `{ status }`.
 * Details require a valid HEALTH_TOKEN (`x-health-token`) in every environment.
 */
function canSeeDetails(request: Request): boolean {
  const expected = env.HEALTH_TOKEN;
  const presented = request.headers.get(HEALTH_TOKEN_HEADER);
  if (!expected || !presented) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/** Liveness + database readiness. Public, rate limited per IP, never cached. */
export const GET = withApi({ auth: 'none', org: 'none', rateLimit: 'default' }, async ({ request }) => {
  const database = await pingDatabase();
  if (!database.ok) {
    throw new ServiceUnavailableError('Database is unreachable');
  }
  if (!canSeeDetails(request)) {
    return apiResult({ status: 'ok' as const });
  }
  return apiResult({
    status: 'ok' as const,
    version: process.env.npm_package_version ?? '0.0.0',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    database: { ok: true, latencyMs: database.latencyMs },
    time: new Date().toISOString(),
  });
});
