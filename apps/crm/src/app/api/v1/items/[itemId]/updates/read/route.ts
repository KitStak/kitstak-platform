import { withApi } from '@/server/api';
import { markUpdatesRead } from '@/server/services/updates';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'update:read', planRead: true, rateLimit: 'default', params: uuidParams('itemId') },
  (ctx) => markUpdatesRead(svc(ctx), { itemId: ctx.params.itemId }),
);
