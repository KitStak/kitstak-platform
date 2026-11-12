import { withApi } from '@/server/api';
import { listBoardRuns } from '@/server/services/automations-center';
import { boardRunsQuerySchema } from '@/server/services/contracts/automations-center';
import { paged, svc, uuidParams } from '../../../../_lib/route-helpers';

/** Run history of every automation on a board (newest first, filterable). */
export const GET = withApi(
  { permission: 'automation:read', params: uuidParams('boardId'), query: boardRunsQuerySchema, rateLimit: 'default' },
  async (ctx) => paged(await listBoardRuns(svc(ctx), ctx.params.boardId, ctx.query)),
);
