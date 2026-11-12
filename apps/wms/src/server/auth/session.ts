/**
 * Session API for Next.js (server components, route handlers, proxy).
 *
 * - `getSessionUser()`  — server components / layouts (reads request headers), DB-verified.
 * - `getRequestSession(db, request)` — route handlers (reads the request's headers).
 *
 * Verification happens in `session-store.ts` against the shared Better Auth instance
 * (blueprint §1.4); cookies are set by Better Auth itself (`/api/auth/*` + nextCookies),
 * so there are no cookie writers here any more.
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import { connection, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAMES } from '@kitstak/auth/options';
import { getAppDb, type AppDb } from '@/server/api/db';
import { log } from '@/server/log';
import { resolveSession, type SessionResolution, type SessionUser } from './session-store';

export {
  bumpSessionVersion,
  listActiveSessions,
  revokeSession,
  revokeUserSessions,
  type SessionUser,
} from './session-store';

/** Shared session cookie (host-only in dev; `__Secure-` prefixed in production). */
export const SESSION_COOKIE = SESSION_COOKIE_NAMES[0];

/** Legacy alias kept for existing imports. */
export type SessionRole = SessionUser['role'];

/** Verifies the session of a route-handler request. */
export async function getRequestSession(
  db: AppDb,
  request: NextRequest | Request,
): Promise<SessionResolution> {
  return await resolveSession(db, request.headers);
}

/** Reads a cookie from a `NextRequest` or a plain `Request`. */
export function readCookie(request: NextRequest | Request, name: string): string | undefined {
  const maybeNext = request as { cookies?: { get(n: string): { value: string } | undefined } };
  if (maybeNext.cookies && typeof maybeNext.cookies.get === 'function') {
    return maybeNext.cookies.get(name)?.value || undefined;
  }
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('=')) || undefined;
  }
  return undefined;
}

/**
 * Session user for server components (memoised per request via React `cache`).
 * Returns null when the cookie is missing, invalid, revoked or the user was deactivated.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // `headers()` stays outside the try: during prerendering Next signals dynamic usage
  // through it, and that signal must propagate.
  const requestHeaders = await headers();
  // Session checks read the clock (expiry): mark the render as request-time.
  await connection();
  try {
    const db = await getAppDb();
    const resolution = await resolveSession(db, requestHeaders);
    return resolution.ok ? resolution.user : null;
  } catch (error: unknown) {
    log.error('getSessionUser failed', { component: 'auth', err: error });
    return null;
  }
});
