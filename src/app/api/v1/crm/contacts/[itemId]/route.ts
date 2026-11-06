import { withApi } from '@/server/api';
import { getContact360 } from '@/server/services/crm-records';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Contact 360: profile, account, deals, related contacts, timeline and next steps. */
export const GET = withApi({ permission: 'item:read', params: uuidParams('itemId') }, (ctx) =>
  getContact360(svc(ctx), ctx.params.itemId),
);
