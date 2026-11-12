import { withApi } from '@/server/api';
import {
  deleteDashboard,
  getDashboard,
  updateDashboard,
  updateDashboardSchema,
} from '@/server/services/dashboards';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('dashboardId');

export const GET = withApi({ permission: 'dashboard:read', params }, (ctx) =>
  getDashboard(svc(ctx), ctx.params.dashboardId),
);

export const PATCH = withApi({ permission: 'dashboard:write', params, body: updateDashboardSchema }, (ctx) =>
  updateDashboard(svc(ctx), ctx.params.dashboardId, ctx.body),
);

export const DELETE = withApi({ permission: 'dashboard:write', params }, (ctx) =>
  deleteDashboard(svc(ctx), ctx.params.dashboardId),
);
