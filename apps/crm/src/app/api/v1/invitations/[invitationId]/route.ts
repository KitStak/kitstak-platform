import { withApi } from '@/server/api';
import { revokeInvitation } from '@/server/services/members';
import { svc, uuidParams } from '../../_lib/route-helpers';

export const DELETE = withApi(
  {
    permission: 'member:invite',
    params: uuidParams('invitationId'),
    audit: {
      action: 'member.invitation_revoked',
      target: (ctx) => ({ type: 'invitation', id: (ctx.params as { invitationId: string }).invitationId }),
    },
  },
  (ctx) => revokeInvitation(svc(ctx), ctx.params.invitationId),
);
