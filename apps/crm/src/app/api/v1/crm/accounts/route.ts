import { withApi } from '@/server/api';
import { listCrmRecords } from '@/server/services/crm-records';
import { svc } from '../../_lib/route-helpers';

/** Flat accounts list for the /crm/accounts index page. */
export const GET = withApi({ permission: 'item:read' }, (ctx) => listCrmRecords(svc(ctx), 'accounts'));
