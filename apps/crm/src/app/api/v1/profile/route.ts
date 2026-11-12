import { withApi } from '@/server/api';
import { updateProfileSchema } from '@/server/services/admin-contracts';
import { getProfile, updateProfile } from '@/server/services/admin-org';
import { svc } from '../_lib/route-helpers';

/** The caller's profile and preferences within the current organization. */
export const GET = withApi({ permission: 'org:read' }, (ctx) => getProfile(svc(ctx)));

export const PATCH = withApi(
  {
    permission: 'org:read',
    body: updateProfileSchema,
    audit: {
      action: 'profile.updated',
      target: (ctx) => ({ type: 'user', id: (ctx.data as { user: { id: string } }).user.id }),
      metadata: (ctx) => ({ fields: Object.keys(ctx.body as object) }),
    },
  },
  (ctx) => updateProfile(svc(ctx), ctx.body),
);
