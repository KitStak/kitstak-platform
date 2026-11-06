import { withApi } from '@/server/api';
import { addWidget, createWidgetSchema } from '@/server/services/dashboards';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'dashboard:write', params: uuidParams('dashboardId'), body: createWidgetSchema },
  async (ctx) => created(await addWidget(svc(ctx), ctx.params.dashboardId, ctx.body)),
);
