import { withApi } from '@/server/api';
import { dashboardSettingsSchema } from '@/server/services/contracts/dashboard-insights';
import { updateDashboardSettings } from '@/server/services/dashboards-insights';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Dashboard preferences stored in `dashboards.config` (privacy, auto refresh, layout lock). */
export const PATCH = withApi(
  {
    permission: 'dashboard:write',
    rateLimit: 'mutation',
    params: uuidParams('dashboardId'),
    body: dashboardSettingsSchema,
  },
  (ctx) => updateDashboardSettings(svc(ctx), ctx.params.dashboardId, ctx.body),
);
