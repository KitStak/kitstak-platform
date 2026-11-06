import { withApi } from '@/server/api';
import { duplicateBoard } from '@/server/services/boards';
import { duplicateBoardSchema } from '@/server/services/contracts/structure-inputs';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  {
    permission: 'board:create',
    rateLimit: 'heavy',
    params: uuidParams('boardId'),
    body: duplicateBoardSchema.optional(),
  },
  async (ctx) => created(await duplicateBoard(svc(ctx), ctx.params.boardId, ctx.body ?? { mode: 'items' })),
);
