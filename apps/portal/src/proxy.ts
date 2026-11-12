/**
 * Edge of every request (Next.js 16 "proxy"). The portal's auth gating lives in the
 * (app) layout; the proxy only consumes the cross-app theme handoff: links from CRM/WMS
 * carry the user's stored theme as a `ks-theme` param (theme stores are per origin, so
 * a sibling app's choice can't be read directly). Persist it to the `kitstak-theme`
 * cookie and redirect to the clean URL so the pre-paint theme script picks it up.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractThemeHandoff, THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS } from '@kitstak/ui/theme';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (request.method === 'GET' && !pathname.startsWith('/api/')) {
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

  return NextResponse.next();
}

export const config = {
  // Documents only; static assets and Next internals never carry the handoff param.
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
