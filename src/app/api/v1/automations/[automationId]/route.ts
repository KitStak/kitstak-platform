import { withApi } from '@/server/api';
import { updateAutomationSchema } from '@/server/automations-engine/recipes';
import { deleteAutomation, getAutomation, updateAutomation } from '@/server/services/automations';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('automationId');
const target = (ctx: { params: unknown }) => ({
  type: 'automation',
  id: (ctx.params as { automationId: string }).automationId,
});

export const GET = withApi({ permission: 'automation:read', params }, (ctx) =>
  getAutomation(svc(ctx), ctx.params.automationId),
);

export const PATCH = withApi(
  {
    permission: 'automation:write',
    params,
    body: updateAutomationSchema,
    audit: { action: 'automation.updated', target },
  },
  (ctx) => updateAutomation(svc(ctx), ctx.params.automationId, ctx.body),
);

export const DELETE = withApi(
  { permission: 'automation:write', params, audit: { action: 'automation.deleted', target } },
  (ctx) => deleteAutomation(svc(ctx), ctx.params.automationId),
);
