import { withApi } from '@/server/api';
import { insightBatchSchema } from '@/server/services/contracts/dashboard-insights';
import { queryWidgetInsights } from '@/server/services/dashboards-insights';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/**
 * Data for many widgets in one round trip, computed from one dataset load per board set.
 * POST because widget configs travel in the body; it is a read.
 */
export const POST = withApi(
  {
    permission: 'dashboard:read',
    rateLimit: 'default',
    params: uuidParams('dashboardId'),
    body: insightBatchSchema,
  },
  (ctx) => queryWidgetInsights(svc(ctx), ctx.params.dashboardId, ctx.body),
);
