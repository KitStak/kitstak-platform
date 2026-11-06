import { withApi } from '@/server/api';
import { deleteColumn, updateColumn } from '@/server/services/columns';
import { updateColumnSchema } from '@/server/services/contracts/structure-inputs';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('boardId', 'columnId');

export const PATCH = withApi({ permission: 'board:write', params, body: updateColumnSchema }, (ctx) =>
  updateColumn(svc(ctx), ctx.params.boardId, ctx.params.columnId, ctx.body),
);

export const DELETE = withApi({ permission: 'board:write', params }, (ctx) =>
  deleteColumn(svc(ctx), ctx.params.boardId, ctx.params.columnId),
);
