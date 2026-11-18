/**
 * Edge of every request (Next.js 16 "proxy"). Auth gating lives in the (app) layout. The proxy:
 * 1. Consumes the cross-app theme handoff: links from Portal/CRM/WMS carry the stored theme as
 *    a `ks-theme` param. Persist it to the `kitstak-theme` cookie and redirect to the clean URL
 *    so the pre-paint theme script picks it up (portal pattern).
 * 2. Sets the Content-Security-Policy with a fresh nonce on every page (CRM pattern). Next reads
 *    the nonce from the request header and stamps its own scripts with it, so every page must be
 *    rendered per request (the root layout reads the nonce, which makes that so).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractThemeHandoff, THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS } from '@kitstak/ui/theme';
import { API_CONTENT_SECURITY_POLICY, buildContentSecurityPolicy, createNonce, NONCE_HEADER } from '@/server/http/csp';

const CSP_HEADER = 'Content-Security-Policy';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  if (request.method === 'GET' && !isApi) {
    const handoff = extractThemeHandoff(request.nextUrl);
    if (handoff) {
      const response = NextResponse.redirect(handoff.cleanUrl);
      response.cookies.set(THEME_COOKIE, handoff.theme, { path: '/', maxAge: THEME_COOKIE_MAX_AGE_SECONDS, sameSite: 'lax' });
      return response;
    }
  }
  // Layouts can't see the pathname; forward it so signed-out redirects return to the same page.
  const headers = new Headers(request.headers);
  headers.set('x-ks-path', `${pathname}${request.nextUrl.search}`);
  // A caller must never pick the nonce.
  headers.delete(NONCE_HEADER);

  if (isApi) {
    const response = NextResponse.next({ request: { headers } });
    response.headers.set(CSP_HEADER, API_CONTENT_SECURITY_POLICY);
    return response;
  }

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  headers.set(NONCE_HEADER, nonce);
  headers.set(CSP_HEADER, csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(CSP_HEADER, csp);
  return response;
}

export const config = {
  // Every page and API route. Static files and Next internals carry no page, so they are skipped.
  matcher: ['/((?!_next/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|css|js|map|txt|xml|webmanifest)$).*)'],
};
