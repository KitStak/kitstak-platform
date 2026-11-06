import { withApi } from '@/server/api';
import { getAccount360 } from '@/server/services/crm-records';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Account 360: profile, contacts, deals, timeline and next steps. */
export const GET = withApi({ permission: 'item:read', params: uuidParams('itemId') }, (ctx) =>
  getAccount360(svc(ctx), ctx.params.itemId),
);
