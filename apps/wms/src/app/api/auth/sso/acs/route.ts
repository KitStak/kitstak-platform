/**
 * `POST /api/auth/sso/acs` — SAML assertion consumer. SAML assertions are not accepted yet:
 * the identity provider is sent back to the sign-in page with a clear message (use the
 * provider's OpenID Connect app, which every IdP in the catalog offers).
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/api/define-route';
import { writeAudit } from '@/server/auth/audit';

export const POST = defineRoute({
  auth: 'public',
  csrf: false,
  transaction: false,
  handler: async ({ db, request, ip, userAgent }) => {
    await writeAudit(db, {
      action: 'auth.sso_login',
      entity: 'user',
      entityId: 'saml',
      userId: null,
      ip,
      userAgent,
      outcome: 'failure',
      detail: { reason: 'SAML assertion received; SAML sign-in is not enabled' },
    });
    const message =
      "SAML sign-in isn't enabled for this workspace. Use your identity provider's OpenID Connect app.";
    return NextResponse.redirect(
      new URL(`/login?sso_error=${encodeURIComponent(message)}`, new URL(request.url).origin),
      303,
    );
  },
});
