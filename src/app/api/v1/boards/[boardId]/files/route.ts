import { withApi } from '@/server/api';
import { listBoardFiles } from '@/server/services/files';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi({ permission: 'file:read', params: uuidParams('boardId') }, (ctx) =>
  listBoardFiles(svc(ctx), ctx.params.boardId),
);
