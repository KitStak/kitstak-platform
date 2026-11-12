import { withApi } from '@/server/api';
import { duplicateDashboardSchema } from '@/server/services/contracts/dashboard-insights';
import { duplicateDashboard } from '@/server/services/dashboards-insights';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  {
    permission: 'dashboard:write',
    rateLimit: 'mutation',
    params: uuidParams('dashboardId'),
    body: duplicateDashboardSchema,
  },
  async (ctx) => created(await duplicateDashboard(svc(ctx), ctx.params.dashboardId, ctx.body.name)),
);
