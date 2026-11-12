/**
 * Session-cookie helpers bound to the shared `kitstak` cookie prefix, for each app's
 * edge proxy (blueprint §1.1 `session-cookie.ts`; usage mirrors `apps/crm/src/proxy.ts`).
 *
 * The cookie value is NOT trusted for authorization — proxies use it only as an
 * optimistic "probably signed in" gate; layouts and API guards validate the session.
 */
import { getSessionCookie } from 'better-auth/cookies';
import { SESSION_COOKIE_NAMES, SESSION_COOKIE_PREFIX } from './options';

export { SESSION_COOKIE_NAMES, SESSION_COOKIE_PREFIX };

/** Raw session cookie value (or null) with the `kitstak` prefix pre-bound. */
export function getKitstakSessionCookie(request: Request): string | null {
  return getSessionCookie(request, { cookiePrefix: SESSION_COOKIE_PREFIX });
}

/** Optimistic signed-in check for edge proxies (redirect-to-login gating only). */
export function hasKitstakSessionCookie(request: Request): boolean {
  return getKitstakSessionCookie(request) !== null;
}
