import { withApi } from '@/server/api';
import { bulkInvitationSchema, createInvitations } from '@/server/services/wizards-invitations';
import { svc } from '../../_lib/route-helpers';

/** Invite up to 50 people at once; returns a per-email result (partial success allowed). */
export const POST = withApi(
  {
    permission: 'member:invite',
    rateLimit: 'heavy',
    body: bulkInvitationSchema,
    audit: {
      action: 'member.invited_bulk',
      metadata: (ctx) => ({ count: (ctx.body as { invitations: unknown[] }).invitations.length }),
    },
  },
  (ctx) => createInvitations(svc(ctx), ctx.body),
);
