import { defineRoute } from '@/server/api/define-route';
import { listActiveSessions } from '@/server/auth/session';

/** GET /api/auth/sessions — the caller's live sessions (for "Sign out other sessions"). */
export const GET = defineRoute({
  name: 'GET /api/auth/sessions',
  handler: async ({ db, auth }) =>
    (await listActiveSessions(db, auth.user.id)).map((s) => ({
      ...s,
      isCurrent: s.id === auth.user.sessionId,
    })),
});
