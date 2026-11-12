import { withApi } from '@/server/api';
import { insightQuerySchema } from '@/server/services/contracts/dashboard-insights';
import { queryWidgetInsight } from '@/server/services/dashboards-insights';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/**
 * Widget data with dashboard-level filters. POST because the widget config travels in the body
 * (the Add-widget wizard previews configs that are not saved yet); it is a read, so it uses the
 * read rate-limit policy.
 */
export const POST = withApi(
  {
    permission: 'dashboard:read',
    rateLimit: 'default',
    params: uuidParams('dashboardId'),
    body: insightQuerySchema,
  },
  (ctx) => queryWidgetInsight(svc(ctx), ctx.params.dashboardId, ctx.body),
);
