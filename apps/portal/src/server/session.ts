/**
 * Session helpers for Server Components and Route Handlers (CRM session.ts, portal-sized).
 */
import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, type AuthSession } from '@/server/auth';

export type Session = AuthSession;

/** Session from an explicit header set (route handlers pass `request.headers`). */
export async function getSessionFromHeaders(requestHeaders: Headers): Promise<Session | null> {
  return auth.api.getSession({ headers: requestHeaders });
}

/** Current request's session (memoized for the duration of a React server render). */
export const getSession = cache(async (): Promise<Session | null> => getSessionFromHeaders(await headers()));

/** For pages/layouts: redirects to /login (preserving the target) instead of throwing. */
export async function requirePageSession(returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return session;
}
