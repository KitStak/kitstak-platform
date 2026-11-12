import { withApi } from '@/server/api';
import { editUpdateSchema } from '@/server/services/contracts/item-inputs';
import { deleteUpdate, editUpdate } from '@/server/services/updates';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('updateId');

export const PATCH = withApi(
  { permission: 'update:write', params, body: editUpdateSchema, maxBodyBytes: 512 * 1024 },
  (ctx) => editUpdate(svc(ctx), ctx.params.updateId, ctx.body),
);

export const DELETE = withApi({ permission: 'update:write', params }, (ctx) =>
  deleteUpdate(svc(ctx), ctx.params.updateId),
);
