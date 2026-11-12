/** `GET /api/account/password-policy` — policy hints for live password meters (any signed-in user). */
import { defineRoute } from '@/server/api/define-route';
import { getPasswordPolicy } from '@/server/auth/password-policy';

export const GET = defineRoute({
  handler: async ({ db }) => {
    const p = await getPasswordPolicy(db);
    return {
      minLength: p.minLength,
      requireUpper: p.requireUpper,
      requireNumber: p.requireNumber,
      requireSymbol: p.requireSymbol,
      maxAgeDays: p.maxAgeDays ?? null,
    };
  },
});
