import { withApi } from '@/server/api';
import { logCrmActivity } from '@/server/services/crm-activities';
import { logActivitySchema } from '@/server/services/crm-contracts';
import { created, svc } from '../../_lib/route-helpers';

/** Log a call / email / meeting / note as an Activities item linked to contacts and deals. */
export const POST = withApi({ permission: 'item:write', body: logActivitySchema }, async (ctx) =>
  created(await logCrmActivity(svc(ctx), ctx.body)),
);
