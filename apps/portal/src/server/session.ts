/**
 * Session helpers for Server Components and Route Handlers (CRM session.ts, portal-sized).
 */
import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { RETURN_TO_HEADER } from '@/lib/return-to';
import { safeNextPath } from '@/lib/routes';
import { auth, type AuthSession } from '@/server/auth';

export type Session = AuthSession;

/** Session from an explicit header set (route handlers pass `request.headers`). */
export async function getSessionFromHeaders(requestHeaders: Headers): Promise<Session | null> {
  return auth.api.getSession({ headers: requestHeaders });
}

/** Current request's session (memoized for the duration of a React server render). */
export const getSession = cache(async (): Promise<Session | null> => getSessionFromHeaders(await headers()));

/**
 * The sign in address for a signed out visit: `/login?next=<the page that was asked for>`. The page
 * comes from the header the proxy wrote (its full path and query), so the person lands on exactly
 * what they opened: `/billing?fix=payment` from the failed payment email, an invoice from a receipt,
 * the plan picker from a trial email. `fallback` is used when there is no such header (a request
 * that did not pass the proxy) or when it is not a safe same origin path.
 */
export async function signInRedirectPath(fallback?: string): Promise<string> {
  const asked = (await headers()).get(RETURN_TO_HEADER);
  const safe = asked ? safeNextPath(asked, '') : '';
  const target = safe !== '' ? safe : (fallback ?? '');
  // Sending someone "back to the launcher" needs no parameter: that is where sign in ends anyway.
  return target !== '' && target !== '/' ? `/login?next=${encodeURIComponent(target)}` : target === '/' ? '/login?next=%2F' : '/login';
}

/** For pages/layouts: redirects to /login (preserving the page that was asked for) instead of throwing. */
export async function requirePageSession(returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(await signInRedirectPath(returnTo));
  return session;
}
