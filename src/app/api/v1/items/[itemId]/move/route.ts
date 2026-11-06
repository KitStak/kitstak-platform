import { withApi } from '@/server/api';
import { moveItemSchema } from '@/server/services/contracts/item-inputs';
import { moveItem } from '@/server/services/items';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'item:write', params: uuidParams('itemId'), body: moveItemSchema },
  (ctx) => moveItem(svc(ctx), ctx.params.itemId, ctx.body),
);
