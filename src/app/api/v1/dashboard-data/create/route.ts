import { withApi } from '@/server/api';
import { createDashboardFlowSchema } from '@/server/services/contracts/dashboard-insights';
import { createDashboardFlow } from '@/server/services/dashboards-insights';
import { created, svc } from '../../_lib/route-helpers';

/** Dashboard creation flow: name, workspace, privacy, boards and an optional starter layout. */
export const POST = withApi(
  { permission: 'dashboard:write', rateLimit: 'mutation', body: createDashboardFlowSchema },
  async (ctx) => created(await createDashboardFlow(svc(ctx), ctx.body)),
);
