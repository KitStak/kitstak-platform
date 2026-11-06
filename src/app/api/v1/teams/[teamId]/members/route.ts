import { withApi } from '@/server/api';
import { addTeamMembers, removeTeamMembers, teamMembersSchema } from '@/server/services/members';
import { svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('teamId');

export const POST = withApi({ permission: 'team:write', params, body: teamMembersSchema }, (ctx) =>
  addTeamMembers(svc(ctx), ctx.params.teamId, ctx.body.userIds),
);

export const DELETE = withApi({ permission: 'team:write', params, body: teamMembersSchema }, (ctx) =>
  removeTeamMembers(svc(ctx), ctx.params.teamId, ctx.body.userIds),
);
