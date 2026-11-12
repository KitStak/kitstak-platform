import { withApi } from '@/server/api';
import { restoreAutomation } from '@/server/services/automations-center';
import { restoreAutomationSchema } from '@/server/services/contracts/automations-center';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

/** Undo a delete: restore a soft-deleted automation (within the undo window). */
export const POST = withApi(
  {
    permission: 'automation:write',
    params: uuidParams('automationId'),
    body: restoreAutomationSchema,
    rateLimit: 'mutation',
  },
  (ctx) => restoreAutomation(svc(ctx), ctx.params.automationId, ctx.body),
);
