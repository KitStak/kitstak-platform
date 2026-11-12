import { withApi } from '@/server/api';
import { listLinkedItems } from '@/server/services/item-reads';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi({ permission: 'item:read', params: uuidParams('itemId') }, (ctx) =>
  listLinkedItems(svc(ctx), ctx.params.itemId),
);
