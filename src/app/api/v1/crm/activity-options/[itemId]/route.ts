import { withApi } from '@/server/api';
import { getActivityOptions } from '@/server/services/crm-records';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Activity types + linkable contacts/deals for the "Log activity" composer. */
export const GET = withApi({ permission: 'item:read', params: uuidParams('itemId') }, (ctx) =>
  getActivityOptions(svc(ctx), ctx.params.itemId),
);
