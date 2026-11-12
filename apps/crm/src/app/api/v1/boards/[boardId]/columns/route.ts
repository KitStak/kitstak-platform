import { withApi } from '@/server/api';
import { createColumn, listColumns } from '@/server/services/columns';
import { createColumnSchema } from '@/server/services/contracts/structure-inputs';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('boardId');

export const GET = withApi({ permission: 'board:read', params }, (ctx) =>
  listColumns(svc(ctx), ctx.params.boardId),
);

export const POST = withApi({ permission: 'board:write', params, body: createColumnSchema }, async (ctx) =>
  created(await createColumn(svc(ctx), ctx.params.boardId, ctx.body)),
);
