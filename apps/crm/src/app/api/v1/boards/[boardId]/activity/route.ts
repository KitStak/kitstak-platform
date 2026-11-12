import { withApi } from '@/server/api';
import { activityQuerySchema, listBoardActivity } from '@/server/services/activity';
import { paged, svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi(
  { permission: 'board:read', params: uuidParams('boardId'), query: activityQuerySchema },
  async (ctx) => paged(await listBoardActivity(svc(ctx), ctx.params.boardId, ctx.query)),
);
