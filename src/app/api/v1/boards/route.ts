import { withApi } from '@/server/api';
import { createBoard, listBoards } from '@/server/services/boards';
import { createBoardSchema, listBoardsQuerySchema } from '@/server/services/contracts/structure-inputs';
import { created, svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'board:read', query: listBoardsQuerySchema }, (ctx) =>
  listBoards(svc(ctx), ctx.query),
);

export const POST = withApi({ permission: 'board:create', body: createBoardSchema }, async (ctx) =>
  created(await createBoard(svc(ctx), ctx.body)),
);
