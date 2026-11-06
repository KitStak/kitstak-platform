import { withApi } from '@/server/api';
import { updateItemSchema } from '@/server/services/contracts/item-inputs';
import { getItemDetail } from '@/server/services/item-reads';
import { changeItemLifecycle, updateItem } from '@/server/services/items';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('itemId');

/** Item with board columns, group, subitems and linked items (item side panel). */
export const GET = withApi({ permission: 'item:read', params }, (ctx) =>
  getItemDetail(svc(ctx), ctx.params.itemId),
);

/** Rename and/or update several cells at once. */
export const PATCH = withApi({ permission: 'item:write', params, body: updateItemSchema }, (ctx) =>
  updateItem(svc(ctx), ctx.params.itemId, ctx.body),
);

/** Soft delete (to trash). */
export const DELETE = withApi({ permission: 'item:delete', params }, (ctx) =>
  changeItemLifecycle(svc(ctx), ctx.params.itemId, 'delete'),
);
