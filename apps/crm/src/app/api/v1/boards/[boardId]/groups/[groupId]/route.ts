import { withApi } from '@/server/api';
import { updateGroupSchema } from '@/server/services/contracts/structure-inputs';
import { deleteGroup, updateGroup } from '@/server/services/groups';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('boardId', 'groupId');

export const PATCH = withApi({ permission: 'board:write', params, body: updateGroupSchema }, (ctx) =>
  updateGroup(svc(ctx), ctx.params.boardId, ctx.params.groupId, ctx.body),
);

export const DELETE = withApi({ permission: 'item:delete', params }, (ctx) =>
  deleteGroup(svc(ctx), ctx.params.boardId, ctx.params.groupId),
);
