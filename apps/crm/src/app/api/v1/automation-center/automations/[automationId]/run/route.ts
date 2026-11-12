import { withApi } from '@/server/api';
import { runAutomationOnItem } from '@/server/services/automations-center';
import { runAutomationSchema } from '@/server/services/contracts/automations-center';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

/** Run an automation on one item now, or preview it (`dryRun: true`, nothing is written). */
export const POST = withApi(
  {
    permission: 'automation:write',
    params: uuidParams('automationId'),
    body: runAutomationSchema,
    rateLimit: 'mutation',
  },
  (ctx) => runAutomationOnItem(svc(ctx), ctx.params.automationId, ctx.body),
);
