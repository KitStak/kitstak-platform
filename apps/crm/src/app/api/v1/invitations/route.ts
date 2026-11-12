import { withApi } from '@/server/api';
import { createInvitation, createInvitationSchema, listInvitations } from '@/server/services/members';
import { created, svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'member:read' }, (ctx) => listInvitations(svc(ctx)));

export const POST = withApi(
  {
    permission: 'member:invite',
    rateLimit: 'auth',
    body: createInvitationSchema,
    audit: {
      action: 'member.invited',
      target: (ctx) => ({ type: 'invitation', id: (ctx.data as { id: string }).id }),
      metadata: (ctx) => ({ role: (ctx.body as { role: string }).role }),
    },
  },
  async (ctx) => created(await createInvitation(svc(ctx), ctx.body)),
);
