import { withApi } from '@/server/api';
import { createItemSchema, listItemsQuerySchema } from '@/server/services/contracts/item-inputs';
import { listBoardItems } from '@/server/services/item-reads';
import { createItem } from '@/server/services/items';
import { created, paged, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('boardId');

/** Cursor-paginated items in display order (`?groupId=` pages within one group). */
export const GET = withApi({ permission: 'item:read', params, query: listItemsQuerySchema }, async (ctx) =>
  paged(await listBoardItems(svc(ctx), ctx.params.boardId, ctx.query)),
);

export const POST = withApi({ permission: 'item:write', params, body: createItemSchema }, async (ctx) =>
  created(await createItem(svc(ctx), ctx.params.boardId, ctx.body)),
);
