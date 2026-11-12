import { withApi } from '@/server/api';
import { changeBoardLifecycle, getBoard, updateBoard } from '@/server/services/boards';
import { updateBoardSchema } from '@/server/services/contracts/structure-inputs';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('boardId');

export const GET = withApi({ permission: 'board:read', params }, (ctx) =>
  getBoard(svc(ctx), ctx.params.boardId),
);

export const PATCH = withApi({ permission: 'board:write', params, body: updateBoardSchema }, (ctx) =>
  updateBoard(svc(ctx), ctx.params.boardId, ctx.body),
);

/** Soft delete (moves the board to the trash; restorable). */
export const DELETE = withApi(
  {
    permission: 'board:delete',
    params,
    audit: {
      action: 'board.deleted',
      target: (ctx) => ({ type: 'board', id: (ctx.params as { boardId: string }).boardId }),
    },
  },
  (ctx) => changeBoardLifecycle(svc(ctx), ctx.params.boardId, 'delete'),
);
