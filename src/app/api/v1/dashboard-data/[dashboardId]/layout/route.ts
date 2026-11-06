import { withApi } from '@/server/api';
import { layoutUpdateSchema } from '@/server/services/contracts/dashboard-insights';
import { saveDashboardLayout } from '@/server/services/dashboards-insights';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Batch save of widget positions/sizes after a drag or resize (one round trip). */
export const PUT = withApi(
  { permission: 'dashboard:write', rateLimit: 'mutation', params: uuidParams('dashboardId'), body: layoutUpdateSchema },
  (ctx) => saveDashboardLayout(svc(ctx), ctx.params.dashboardId, ctx.body),
);
