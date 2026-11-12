import { withApi } from '@/server/api';
import { activityQuerySchema, listItemActivity } from '@/server/services/activity';
import { paged, svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi(
  { permission: 'item:read', params: uuidParams('itemId'), query: activityQuerySchema },
  async (ctx) => paged(await listItemActivity(svc(ctx), ctx.params.itemId, ctx.query)),
);
