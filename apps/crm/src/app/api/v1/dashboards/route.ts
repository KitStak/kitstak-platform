import { z } from 'zod';
import { withApi } from '@/server/api';
import { createDashboard, createDashboardSchema, listDashboards } from '@/server/services/dashboards';
import { created, svc } from '../_lib/route-helpers';

export const GET = withApi(
  { permission: 'dashboard:read', query: z.object({ workspaceId: z.uuid().optional() }) },
  (ctx) => listDashboards(svc(ctx), ctx.query.workspaceId),
);

export const POST = withApi({ permission: 'dashboard:write', body: createDashboardSchema }, async (ctx) =>
  created(await createDashboard(svc(ctx), ctx.body)),
);
