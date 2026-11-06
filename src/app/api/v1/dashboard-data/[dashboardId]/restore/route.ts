import { withApi } from '@/server/api';
import { restoreDashboard } from '@/server/services/dashboards-insights';
import { emptyBody, svc, uuidParams } from '../../../_lib/route-helpers';

/** Undo a dashboard delete (soft delete). */
export const POST = withApi(
  { permission: 'dashboard:write', rateLimit: 'mutation', params: uuidParams('dashboardId'), body: emptyBody },
  (ctx) => restoreDashboard(svc(ctx), ctx.params.dashboardId),
);
