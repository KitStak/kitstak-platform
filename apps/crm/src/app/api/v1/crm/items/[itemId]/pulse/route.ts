import { withApi } from '@/server/api';
import { getItemPulse } from '@/server/services/pulse-bridge';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('itemId');

/** KitStak Pulse profit for this record: jobs made from a deal, or client profit for an account. */
export const GET = withApi({ permission: 'item:read', params }, (ctx) => getItemPulse(svc(ctx), ctx.params.itemId));
