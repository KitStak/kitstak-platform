/** `POST /api/apps/sso/test` — gear panel "Test connection" for single sign-on (discovery + JWKS, or the SAML certificate). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { notFoundError } from '@/server/api/errors';
import { testSso } from '@/server/repositories/apps-sso';

export const POST = defineRoute({
  permission: 'settings.company_settings.update',
  params: z.object({ key: z.string().trim().min(1).max(60) }),
  transaction: false,
  handler: async ({ db, params }) => {
    if (params.key !== 'sso') throw notFoundError('Connection test');
    return testSso(db);
  },
});
