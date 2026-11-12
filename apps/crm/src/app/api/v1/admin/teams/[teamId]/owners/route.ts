import { withApi } from '@/server/api';
import { teamOwnersSchema } from '@/server/services/admin-contracts';
import { setTeamOwners } from '@/server/services/admin-org';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

export const PUT = withApi(
  {
    permission: 'team:write',
    params: uuidParams('teamId'),
    body: teamOwnersSchema,
    audit: {
      action: 'team.owners_changed',
      target: (ctx) => ({ type: 'team', id: (ctx.params as { teamId: string }).teamId }),
      metadata: (ctx) => ({ owners: (ctx.body as { userIds: string[] }).userIds.length }),
    },
  },
  (ctx) => setTeamOwners(svc(ctx), ctx.params.teamId, ctx.body.userIds),
);
