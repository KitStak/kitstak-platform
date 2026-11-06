import { withApi } from '@/server/api';
import { listDashboardSources } from '@/server/services/dashboards-insights';
import { svc } from '../../_lib/route-helpers';

/** Boards (with columns and groups) and members available as dashboard widget sources. */
export const GET = withApi({ permission: 'dashboard:read', rateLimit: 'default' }, (ctx) =>
  listDashboardSources(svc(ctx)),
);
