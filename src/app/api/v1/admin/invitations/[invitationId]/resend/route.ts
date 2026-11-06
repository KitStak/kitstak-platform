import { withApi } from '@/server/api';
import { resendInvitation } from '@/server/services/admin-users';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

export const POST = withApi(
  {
    permission: 'member:invite',
    rateLimit: 'auth',
    params: uuidParams('invitationId'),
    audit: {
      action: 'member.invitation_resent',
      target: (ctx) => ({ type: 'invitation', id: (ctx.data as { id: string }).id }),
    },
  },
  (ctx) => resendInvitation(svc(ctx), ctx.params.invitationId),
);
