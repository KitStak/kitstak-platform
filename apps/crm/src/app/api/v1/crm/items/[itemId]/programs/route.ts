import { withApi } from '@/server/api';
import { getItemPrograms } from '@/server/services/programs-bridge';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('itemId');

/** KitStak Programs linked to this deal or account, with this month's units and money. */
export const GET = withApi({ permission: 'item:read', params }, (ctx) => getItemPrograms(svc(ctx), ctx.params.itemId));
