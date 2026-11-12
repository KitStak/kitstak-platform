import { withApi } from '@/server/api';
import { duplicateGroup } from '@/server/services/groups';
import { created, svc, uuidParams } from '../../../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'board:write', rateLimit: 'heavy', params: uuidParams('boardId', 'groupId') },
  async (ctx) => created(await duplicateGroup(svc(ctx), ctx.params.boardId, ctx.params.groupId)),
);
