/** `GET /api/users/[id]/sessions` — live sessions. `DELETE` — revoke all (bumps session version). */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { assertIdentityManagedHere } from '@/server/auth/credentials';
import { bumpSessionVersion } from '@/server/auth/session-store';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { loadUser, userSessions } from '@/server/repositories/users';

export const GET = defineRoute({
  permission: 'settings.users.view',
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await userSessions(db, auth, params.id),
});

export const DELETE = defineRoute({
  permission: 'settings.users.edit',
  params: idParamsSchema,
  handler: async ({ db, auth, params, audit }) => {
    await loadUser(db, params.id);
    if (params.id === auth.user.id)
      throw new AppError('INVALID_STATE', 'Use Log out of all devices to end your own sessions');
    await assertIdentityManagedHere(db, params.id, 'sign it out everywhere');
    const before = (await userSessions(db, auth, params.id)).length;
    await bumpSessionVersion(db, params.id);
    await audit({
      action: 'session.revoke_all',
      entity: 'user',
      entityId: params.id,
      detail: { sessions: before },
    });
    return { revoked: before };
  },
});
