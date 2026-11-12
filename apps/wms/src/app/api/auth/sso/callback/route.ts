/** `GET /api/auth/sso/callback` — OpenID Connect redirect target: verifies the ID token and signs the user in. */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { writeAudit } from '@/server/auth/audit';
import { generateCsrfToken, setCsrfCookie } from '@/server/auth/csrf';
import { issueSession, sessionCookieOptions, setSessionCookie } from '@/server/auth/session';
import { completeSso, getSsoConfig, SSO_STATE_COOKIE } from '@/server/repositories/apps-sso';

export const GET = defineRoute({
  auth: 'public',
  transaction: false,
  handler: async ({ db, request, ip, userAgent }) => {
    const url = new URL(request.url);
    const clearState = (res: NextResponse) => {
      res.cookies.set(SSO_STATE_COOKIE, '', { ...sessionCookieOptions(0), path: '/api/auth/sso' });
      return res;
    };
    try {
      const identity = await completeSso(
        db,
        url.origin,
        url.searchParams,
        request.cookies.get(SSO_STATE_COOKIE)?.value,
      );
      const issued = await issueSession(db, identity.userId, { ip, userAgent });
      await writeAudit(db, {
        action: 'auth.sso_login',
        entity: 'user',
        entityId: identity.userId,
        userId: identity.userId,
        ip,
        userAgent,
        outcome: 'success',
        detail: { provider: (await getSsoConfig(db))?.provider ?? 'SSO', subject: identity.subject },
      });
      const res = NextResponse.redirect(new URL(identity.returnTo, url.origin), 302);
      setSessionCookie(res, issued.token, issued.maxAgeSeconds);
      setCsrfCookie(res, generateCsrfToken());
      return clearState(res);
    } catch (e) {
      const message = e instanceof AppError ? e.message : 'Single sign-on failed';
      await writeAudit(db, {
        action: 'auth.sso_login',
        entity: 'user',
        entityId: 'sso',
        userId: null,
        ip,
        userAgent,
        outcome: 'failure',
        detail: { reason: message },
      });
      return clearState(
        NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(message)}`, url.origin), 302),
      );
    }
  },
});
