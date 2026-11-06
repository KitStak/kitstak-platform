import { withApi } from '@/server/api';
import { listAutomationRuns, listRunsQuerySchema } from '@/server/services/automations';
import { paged, svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi(
  { permission: 'automation:read', params: uuidParams('automationId'), query: listRunsQuerySchema },
  async (ctx) => paged(await listAutomationRuns(svc(ctx), ctx.params.automationId, ctx.query)),
);
