import { withApi } from '@/server/api';
import { deleteWidget, updateWidget, updateWidgetSchema } from '@/server/services/dashboards';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('widgetId');

export const PATCH = withApi({ permission: 'dashboard:write', params, body: updateWidgetSchema }, (ctx) =>
  updateWidget(svc(ctx), ctx.params.widgetId, ctx.body),
);

export const DELETE = withApi({ permission: 'dashboard:write', params }, (ctx) =>
  deleteWidget(svc(ctx), ctx.params.widgetId),
);
