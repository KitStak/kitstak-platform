import { withApi } from '@/server/api';
import { getWidgetData } from '@/server/services/dashboards';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi({ permission: 'dashboard:read', params: uuidParams('widgetId') }, (ctx) =>
  getWidgetData(svc(ctx), ctx.params.widgetId),
);
