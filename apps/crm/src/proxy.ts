/**
 * Edge of every request (Next.js 16 "proxy", formerly middleware):
 * 1. Per-request CSP nonce + Content-Security-Policy header (pages are dynamically rendered).
 * 2. Origin check on mutating `/api/*` requests (CSRF defence; `withApi` re-checks).
 * 3. Optimistic auth gate: app routes without a session cookie redirect to `/login?next=`.
 *    The cookie is NOT trusted here — layouts and `withApi` validate the session for real.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { SESSION_COOKIE_PREFIX } from '@/server/auth/options';
import { trustedOrigins } from '@/server/env';
import { checkRequestOrigin } from '@/server/http/origin';
import { buildContentSecurityPolicy, createNonce } from '@/server/http/csp';

/** Routes reachable without a session. Everything else under the app requires sign-in. */
const PUBLIC_PATHS: readonly RegExp[] = [
  /^\/login\/?$/,
  /^\/signup\/?$/,
  /^\/forgot-password\/?$/,
  /^\/reset-password\/?$/,
  /^\/invite(\/.*)?$/,
  /^\/forms\/.+$/, // public form views
  /^\/(privacy|terms)\/?$/, // legal pages
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'FORBIDDEN', message: 'Cross-origin request blocked', details: { reason } } },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const origin = checkRequestOrigin(request.method, request.headers, request.url, trustedOrigins());
    if (!origin.ok) return forbidden(origin.reason);
    return NextResponse.next();
  }

  if (!isPublicPath(pathname) && !getSessionCookie(request, { cookiePrefix: SESSION_COOKIE_PREFIX })) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
