import { z } from 'zod';
import { withApi } from '@/server/api';
import { changeBoardLifecycle } from '@/server/services/boards';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Archive / unarchive / restore from trash. */
export const POST = withApi(
  {
    permission: 'board:write',
    params: uuidParams('boardId'),
    body: z.object({ action: z.enum(['archive', 'unarchive', 'restore']) }),
    audit: {
      action: 'board.lifecycle',
      target: (ctx) => ({ type: 'board', id: (ctx.params as { boardId: string }).boardId }),
      metadata: (ctx) => ({ action: (ctx.body as { action: string }).action }),
    },
  },
  (ctx) => changeBoardLifecycle(svc(ctx), ctx.params.boardId, ctx.body.action),
);
