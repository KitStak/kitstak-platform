/**
 * Next 16 Proxy (formerly middleware) — optimistic edge checks only:
 *   1. Pages without a session cookie redirect to /login?next=…; APIs get a 401 envelope.
 *   2. Page navigations without a `ks_csrf` cookie get one (double-submit CSRF).
 * Real verification (JWT + user_sessions + session_version) happens server-side in
 * `getSessionUser()` / `defineRoute()`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { documentStatusFor, isDocumentRequest } from '@/server/http/status-gates';
import {
  CSRF_COOKIE,
  CSRF_MAX_AGE_SECONDS,
  generateCsrfToken,
  isWellFormedCsrfToken,
} from '@/server/auth/csrf-shared';

const SESSION_COOKIE = 'kitstak_session';

const PUBLIC_PREFIXES: readonly string[] = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/api/auth/',
  '/api/health',
  '/api/cron/',
  '/_next/',
];
// /api/admin/bootstrap guards itself (BOOTSTRAP_ENABLED + Bearer CRON_SECRET); it runs before any user exists.
const PUBLIC_EXACT: readonly string[] = ['/favicon.ico', '/api/auth', '/robots.txt', '/api/admin/bootstrap'];
/** Static assets (anything with a file extension). */
const STATIC_ASSET_RE = /\.[a-zA-Z0-9]+$/;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname) || STATIC_ASSET_RE.test(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ''),
  );
}

function withCsrfCookie(request: NextRequest, response: NextResponse): NextResponse {
  const isPageNavigation = request.method === 'GET' && !request.nextUrl.pathname.startsWith('/api/');
  if (isPageNavigation && !isWellFormedCsrfToken(request.cookies.get(CSRF_COOKIE)?.value)) {
    response.cookies.set(CSRF_COOKIE, generateCsrfToken(), {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: CSRF_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (hasSession && isDocumentRequest(request.method, request.headers)) {
    // Real 403/404 statuses for document loads; the page still renders its in-shell view.
    const status = await documentStatusFor(pathname);
    if (status) return withCsrfCookie(request, NextResponse.next({ status }));
  }
  if (isPublicPath(pathname) || hasSession) {
    return withCsrfCookie(request, NextResponse.next());
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
