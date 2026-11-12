/** `PATCH /api/account/profile` — My Profile (display / first / last name, email; email change needs the current password). */
import { defineRoute } from '@/server/api/define-route';
import { profileSchema } from '@/lib/grid-defs/admin/account';
import { updateOwnProfile } from '@/server/repositories/users-account';

export const PATCH = defineRoute({
  permission: 'settings.my_profile.view',
  body: profileSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const result = await updateOwnProfile(db, auth, actor, body);
    await audit({
      action: 'user.profile_update',
      entity: 'user',
      entityId: auth.user.id,
      detail: { emailChanged: result.emailChanged },
    });
    return result;
  },
});
