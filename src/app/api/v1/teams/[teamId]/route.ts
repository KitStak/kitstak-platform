import { withApi } from '@/server/api';
import { deleteTeam, renameTeam, teamSchema } from '@/server/services/members';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('teamId');
const target = (ctx: { params: unknown }) => ({
  type: 'team',
  id: (ctx.params as { teamId: string }).teamId,
});

export const PATCH = withApi({ permission: 'team:write', params, body: teamSchema }, (ctx) =>
  renameTeam(svc(ctx), ctx.params.teamId, ctx.body.name),
);

export const DELETE = withApi(
  { permission: 'team:write', params, audit: { action: 'team.deleted', target } },
  (ctx) => deleteTeam(svc(ctx), ctx.params.teamId),
);
