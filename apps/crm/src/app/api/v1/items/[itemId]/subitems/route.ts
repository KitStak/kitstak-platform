import { withApi } from '@/server/api';
import { requireItem } from '@/server/services/access';
import { createItemSchema } from '@/server/services/contracts/item-inputs';
import { listSubitems } from '@/server/services/item-reads';
import { createItem } from '@/server/services/items';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('itemId');

export const GET = withApi({ permission: 'item:read', params }, (ctx) =>
  listSubitems(svc(ctx), ctx.params.itemId),
);

export const POST = withApi({ permission: 'item:write', params, body: createItemSchema }, async (ctx) => {
  const service = svc(ctx);
  const { item } = await requireItem(service, ctx.params.itemId, 'write');
  return created(await createItem(service, item.boardId, { ...ctx.body, parentItemId: item.id }));
});
