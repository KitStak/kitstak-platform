/**
 * Edge of every request (Next.js 16 "proxy"). The portal's auth gating lives in the
 * (app) layout; the proxy only consumes the cross-app theme handoff: links from CRM/WMS
 * carry the user's stored theme as a `ks-theme` param (theme stores are per origin, so
 * a sibling app's choice can't be read directly). Persist it to the `kitstak-theme`
 * cookie and redirect to the clean URL so the pre-paint theme script picks it up.
 *
 * It also takes the proof out of an invite link (`/invite/<id>?t=...`) and keeps it in an httpOnly
 * cookie (see `@/lib/invite-proof`).
 *
 * A link that names its organization (`org=<id>`) is sent through `/org/switch` (see
 * `@/lib/org-link`), so a person who is in two organizations lands in the right one.
 *
 * And it notes the page that was asked for in a request header (see `@/lib/return-to`), so a signed
 * out person is sent to sign in and then back to that page, with its query.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { extractThemeHandoff, THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS } from '@kitstak/ui/theme';
import {
  INVITE_PROOF_COOKIE,
  INVITE_PROOF_MAX_AGE_SECONDS,
  inviteProofCookieValue,
  invitationIdFromPath,
  looksLikeInviteProof,
} from '@/lib/invite-proof';
import { orgSwitchRedirect } from '@/lib/org-link';
import { RETURN_TO_HEADER, returnToOf } from '@/lib/return-to';

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

    // The link in an invite email carries a proof that only that mailbox has (`?t=`). Keep it in an
    // httpOnly cookie and go on to the clean address, so it is not left in the address bar or in
    // history. The signup actions check it with the server secret; here it is only stored.
    const invitationId = invitationIdFromPath(pathname);
    const proof = invitationId ? request.nextUrl.searchParams.get('t') : null;
    if (invitationId && proof !== null) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete('t');
      const response = NextResponse.redirect(clean);
      if (looksLikeInviteProof(proof)) {
        const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
        response.cookies.set(INVITE_PROOF_COOKIE, inviteProofCookieValue(invitationId, proof), {
          path: '/',
          maxAge: INVITE_PROOF_MAX_AGE_SECONDS,
          sameSite: 'lax',
          httpOnly: true,
          secure: https,
        });
      }
      return response;
    }
  }

  // A link that names its organization (`org=<id>`, from a billing email or from another app) goes
  // through the switch route first, so the page opens for that organization (see `@/lib/org-link`).
  if (request.method === 'GET' && !pathname.startsWith('/api/')) {
    const viaSwitch = orgSwitchRedirect(pathname, request.nextUrl.search);
    if (viaSwitch) return NextResponse.redirect(new URL(viaSwitch, request.url));
  }

  // The page that was asked for, for the session guards. Always written here (or removed), so a
  // header a browser sent under this name never reaches the server code.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(RETURN_TO_HEADER);
  if (request.method === 'GET' && !pathname.startsWith('/api/')) {
    const returnTo = returnToOf(pathname, request.nextUrl.search);
    if (returnTo) requestHeaders.set(RETURN_TO_HEADER, returnTo);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Documents only; static assets and Next internals never carry the handoff param.
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
