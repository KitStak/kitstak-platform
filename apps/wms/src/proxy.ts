/**
 * Next 16 Proxy (formerly middleware) — optimistic edge checks only:
 * pages without a `kitstak.session_token` cookie redirect to /login?next=…; APIs get a
 * 401 envelope. Real verification (Better Auth `core.session`) happens server-side in
 * `getSessionUser()` / `defineRoute()`. The `ks_csrf` double-submit cookie is retired
 * (blueprint §1.4): Better Auth guards /api/auth/*, `defineRoute` keeps the same-origin
 * check for every other mutation.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractThemeHandoff, THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS } from '@kitstak/ui/theme';
import { hasKitstakSessionCookie } from '@kitstak/auth/session-cookie';
import { documentStatusFor, isDocumentRequest } from '@/server/http/status-gates';

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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // Cross-app theme handoff: persist a theme carried by a sibling-app link (`ks-theme`
  // param) to the cookie and redirect to the clean URL, BEFORE the auth gate so the
  // param never leaks into `/login?next=` round-trips.
  if (request.method === 'GET' && !pathname.startsWith('/api/') && !STATIC_ASSET_RE.test(pathname)) {
    const handoff = extractThemeHandoff(request.nextUrl);
    if (handoff) {
      const response = NextResponse.redirect(handoff.cleanUrl);
      response.cookies.set(THEME_COOKIE, handoff.theme, {
        path: '/',
        maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
        sameSite: 'lax',
      });
      return response;
    }
  }

  const hasSession = hasKitstakSessionCookie(request);

  if (hasSession && isDocumentRequest(request.method, request.headers)) {
    // Real 403/404 statuses for document loads; the page still renders its in-shell view.
    const status = await documentStatusFor(pathname);
    if (status) return NextResponse.next({ status });
  }
  if (isPublicPath(pathname) || hasSession) {
    return NextResponse.next();
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
