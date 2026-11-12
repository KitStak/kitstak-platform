import { withApi } from '@/server/api';
import { removeMember, updateMemberRole, updateMemberSchema } from '@/server/services/members';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('memberId');
const target = (ctx: { params: unknown }) => ({
  type: 'member',
  id: (ctx.params as { memberId: string }).memberId,
});

export const PATCH = withApi(
  {
    permission: 'member:update',
    rateLimit: 'auth',
    params,
    body: updateMemberSchema,
    audit: {
      action: 'member.role_changed',
      target,
      metadata: (ctx) => ({ role: (ctx.body as { role: string }).role }),
    },
  },
  (ctx) => updateMemberRole(svc(ctx), ctx.params.memberId, ctx.body.role),
);

export const DELETE = withApi(
  { permission: 'member:remove', rateLimit: 'auth', params, audit: { action: 'member.removed', target } },
  (ctx) => removeMember(svc(ctx), ctx.params.memberId),
);
