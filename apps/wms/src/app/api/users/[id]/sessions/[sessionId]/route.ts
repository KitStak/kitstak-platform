/** `DELETE /api/users/[id]/sessions/[sessionId]` — revokes one session (logout on next click). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { idSchema } from '@/server/repositories/platform-common';
import { revokeUserSession } from '@/server/repositories/users';

export const DELETE = defineRoute({
  permission: 'settings.users.edit',
  params: z.object({ id: idSchema, sessionId: idSchema }),
  handler: async ({ db, auth, params, audit }) => {
    const result = await revokeUserSession(db, auth, params.id, params.sessionId);
    await audit({
      action: 'session.revoke',
      entity: 'user',
      entityId: params.id,
      detail: { sessionId: params.sessionId },
    });
    return result;
  },
});
