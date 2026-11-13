/**
 * Edge of every request (Next.js 16 "proxy"). Auth gating lives in the (app) layout; the proxy
 * only consumes the cross-app theme handoff: links from Portal/CRM/WMS carry the stored theme as
 * a `ks-theme` param. Persist it to the `kitstak-theme` cookie and redirect to the clean URL so
 * the pre-paint theme script picks it up (portal pattern).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractThemeHandoff, THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS } from '@kitstak/ui/theme';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (request.method === 'GET' && !pathname.startsWith('/api/')) {
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
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
