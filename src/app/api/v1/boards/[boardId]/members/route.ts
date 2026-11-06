import { withApi } from '@/server/api';
import { setBoardMembers } from '@/server/services/boards';
import { boardMembersSchema } from '@/server/services/contracts/structure-inputs';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const PUT = withApi(
  {
    permission: 'board:share',
    params: uuidParams('boardId'),
    body: boardMembersSchema,
    audit: {
      action: 'board.shared',
      target: (ctx) => ({ type: 'board', id: (ctx.params as { boardId: string }).boardId }),
    },
  },
  (ctx) => setBoardMembers(svc(ctx), ctx.params.boardId, ctx.body),
);
