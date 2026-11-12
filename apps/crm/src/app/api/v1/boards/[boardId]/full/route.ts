import { z } from 'zod';
import { withApi } from '@/server/api';
import { getBoardPayload } from '@/server/services/boards';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** First-paint payload: board + columns + groups + views + first page of items + users. */
export const GET = withApi(
  {
    permission: 'board:read',
    params: uuidParams('boardId'),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).default(300),
      cursor: z.string().max(512).optional(),
    }),
  },
  (ctx) => getBoardPayload(svc(ctx), ctx.params.boardId, ctx.query),
);
