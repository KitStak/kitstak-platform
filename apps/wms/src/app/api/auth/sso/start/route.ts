/**
 * `GET /api/auth/sso/start?returnTo=/path` — single sign-on entry.
 *
 * TODO(blueprint §1.4, DEFERRED): the hand-rolled OIDC+PKCE flow (apps-sso.ts
 * `startSso`/`completeSso`) must be re-registered as a Better Auth `genericOAuth`
 * provider built dynamically from the `apps` table row `key='sso'` (AES config storage
 * via INTEGRATION_KEY kept), so the provider callback lands in the shared session
 * tables. Until that port lands, interactive SSO sign-in answers 501; the enforce /
 * admin break-glass / allowedDomains / never-auto-create rules already run as hooks on
 * `/sign-in/email` (src/server/auth/auth.ts) and `/api/auth/sso/status` stays live for
 * the login page.
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/api/define-route';

export const GET = defineRoute({
  auth: 'public',
  transaction: false,
  handler: ({ request }) => {
    const url = new URL(request.url);
    const message = 'Single sign-on is being upgraded and is temporarily unavailable. Use your password.';
    const wantsJson = request.headers.get('accept')?.includes('application/json');
    if (wantsJson) {
      return NextResponse.json({ success: false, error: message, code: 'NOT_IMPLEMENTED' }, { status: 501 });
    }
    return NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(message)}`, url.origin), 302);
  },
});
