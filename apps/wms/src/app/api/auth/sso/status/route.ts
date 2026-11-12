/** `GET /api/auth/sso/status` — public: whether the sign-in page shows "Sign in with SSO", plus the branding sign-in message. */
import { defineRoute } from '@/server/api/define-route';
import { ssoPublicStatus } from '@/server/repositories/apps-sso';
import { getBranding } from '@/server/repositories/apps-branding';

export const GET = defineRoute({
  auth: 'public',
  handler: async ({ db }) => ({
    ...(await ssoPublicStatus(db)),
    loginMessage: (await getBranding(db))?.loginMessage ?? null,
  }),
});
