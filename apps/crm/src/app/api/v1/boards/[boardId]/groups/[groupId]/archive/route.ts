import { z } from 'zod';
import { withApi } from '@/server/api';
import { setGroupArchived } from '@/server/services/groups';
import { svc, uuidParams } from '../../../../../_lib/route-helpers';

export const POST = withApi(
  {
    permission: 'board:write',
    params: uuidParams('boardId', 'groupId'),
    body: z.object({ archived: z.boolean() }),
  },
  (ctx) => setGroupArchived(svc(ctx), ctx.params.boardId, ctx.params.groupId, ctx.body.archived),
);
