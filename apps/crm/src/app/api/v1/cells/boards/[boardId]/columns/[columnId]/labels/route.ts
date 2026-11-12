import { withApi } from '@/server/api';
import { labelUsage, saveLabelsInputSchema, saveLabelsWithReassign } from '@/server/services/cells-support';
import { svc, uuidParams } from '../../../../../../_lib/route-helpers';

const params = uuidParams('boardId', 'columnId');

/** Board-wide usage count per label id (delete-label warnings). */
export const GET = withApi({ permission: 'item:read', params }, (ctx) =>
  labelUsage(svc(ctx), ctx.params.boardId, ctx.params.columnId),
);

/** Save labels and reassign cells of deleted labels atomically. */
export const PUT = withApi(
  { permission: 'board:write', params, body: saveLabelsInputSchema, rateLimit: 'mutation' },
  (ctx) => saveLabelsWithReassign(svc(ctx), ctx.params.boardId, ctx.params.columnId, ctx.body),
);
