import { withApi } from '@/server/api';
import { bulkCreateItemsSchema } from '@/server/services/contracts/item-inputs';
import { bulkCreateItems } from '@/server/services/items-bulk';
import { created, svc, uuidParams } from '../../../../_lib/route-helpers';

export const POST = withApi(
  {
    permission: 'item:write',
    rateLimit: 'heavy',
    params: uuidParams('boardId'),
    body: bulkCreateItemsSchema,
    maxBodyBytes: 4 * 1024 * 1024,
  },
  async (ctx) => created(await bulkCreateItems(svc(ctx), ctx.params.boardId, ctx.body)),
);
