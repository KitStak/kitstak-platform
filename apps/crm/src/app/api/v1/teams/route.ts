import { withApi } from '@/server/api';
import { createTeam, listTeams, teamSchema } from '@/server/services/members';
import { created, svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'team:read' }, (ctx) => listTeams(svc(ctx)));

export const POST = withApi(
  {
    permission: 'team:write',
    body: teamSchema,
    audit: {
      action: 'team.created',
      target: (ctx) => ({ type: 'team', id: (ctx.data as { id: string }).id }),
    },
  },
  async (ctx) => created(await createTeam(svc(ctx), ctx.body.name)),
);
