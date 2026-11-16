/**
 * Shared plumbing for the org-level tenancy routes (`/api/tenancy/*`). These run BEFORE the
 * user has a warehouse (setup) or while changing which one is open (switch), so they cannot
 * use `defineRoute` (which requires a resolved warehouse). Same guarantees, by hand:
 * same-origin check on mutations, a DB-verified Better Auth session (platform handle), a
 * per-user rate limit, envelope responses and one log line.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getPlatformDb, type AppDb } from '@/server/api/db';
import { jsonError, jsonOk } from '@/server/api/envelope';
import { AppError, toAppError, unauthenticatedError } from '@/server/api/errors';
import { getWmsAuth } from '@/server/auth/auth';
import { verifyOrigin } from '@/server/auth/origin';
import { hitRateLimit, RATE_LIMITS } from '@/server/auth/rate-limit';
import { log } from '@/server/log';
import { WMS_ORG_COOKIE } from './registry';

export interface TenancyRouteCtx {
  readonly platformDb: AppDb;
  readonly userId: string;
  readonly body: unknown;
}

/** One year: the switcher choice is a preference, re-validated on every request. */
const ORG_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** Sets the org-switcher cookie on a response. */
export function setOrgCookie(response: NextResponse, orgId: string): void {
  response.cookies.set(WMS_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ORG_COOKIE_MAX_AGE_S,
  });
}

/**
 * Wraps a POST handler: returns `{ data, orgId? }` → envelope (+ org cookie when `orgId`).
 */
export function tenancyRoute(
  name: string,
  handler: (ctx: TenancyRouteCtx) => Promise<{ readonly data: unknown; readonly orgId?: string }>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const requestId = randomUUID();
    const started = Date.now();
    let status = 500;
    let userId: string | null = null;
    try {
      if (!verifyOrigin(request).ok)
        throw new AppError('CSRF', 'Cross-site requests are not allowed. Refresh the page and try again.');
      const platformDb = await getPlatformDb();
      const auth = await getWmsAuth();
      const session = await auth.api
        .getSession({ headers: request.headers, query: { disableCookieCache: true } })
        .catch(() => null);
      if (!session) throw unauthenticatedError();
      userId = session.user.id;
      const limit = await hitRateLimit(platformDb, RATE_LIMITS.mutation, session.user.id);
      if (!limit.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.', {
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        });
      }
      const body: unknown = await request.json().catch(() => null);
      const result = await handler({ platformDb, userId: session.user.id, body });
      const response = jsonOk(result.data, { headers: { 'x-request-id': requestId } });
      if (result.orgId) setOrgCookie(response, result.orgId);
      status = response.status;
      return response;
    } catch (error: unknown) {
      const appError = toAppError(error);
      status = appError.status;
      if (appError.code === 'INTERNAL') log.error('tenancy route failed', { route: name, err: error });
      return jsonError(appError, requestId);
    } finally {
      log.info('request', { route: name, method: 'POST', userId, status, ms: Date.now() - started, requestId });
    }
  };
}
