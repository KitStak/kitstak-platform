import { withApi } from '@/server/api';
import { updateViewSchema } from '@/server/services/contracts/structure-inputs';
import { deleteView, updateView } from '@/server/services/views';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('viewId');

/** Personal views need only read access; shared view edits are checked in the service. */
export const PATCH = withApi({ permission: 'board:read', params, body: updateViewSchema }, (ctx) =>
  updateView(svc(ctx), ctx.params.viewId, ctx.body),
);

export const DELETE = withApi({ permission: 'board:read', params }, (ctx) =>
  deleteView(svc(ctx), ctx.params.viewId),
);
