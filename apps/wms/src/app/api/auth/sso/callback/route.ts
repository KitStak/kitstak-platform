/**
 * `GET /api/auth/sso/callback` — OIDC redirect target of the legacy hand-rolled flow.
 *
 * TODO(blueprint §1.4, DEFERRED): replaced by the Better Auth `genericOAuth` provider
 * callback once the SSO port lands (see ../start/route.ts). Any stale provider redirect
 * arriving here is sent back to the login page.
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/api/define-route';

export const GET = defineRoute({
  auth: 'public',
  transaction: false,
  handler: ({ request }) => {
    const url = new URL(request.url);
    const message = 'Single sign-on is being upgraded and is temporarily unavailable. Use your password.';
    return NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(message)}`, url.origin), 302);
  },
});
