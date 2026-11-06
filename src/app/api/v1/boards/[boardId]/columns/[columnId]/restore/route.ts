import { withApi } from '@/server/api';
import { restoreColumn } from '@/server/services/columns';
import { svc, uuidParams } from '../../../../../_lib/route-helpers';

export const POST = withApi({ permission: 'board:write', params: uuidParams('boardId', 'columnId') }, (ctx) =>
  restoreColumn(svc(ctx), ctx.params.boardId, ctx.params.columnId),
);
