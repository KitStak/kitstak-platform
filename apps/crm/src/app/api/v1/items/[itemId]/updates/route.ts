import { withApi } from '@/server/api';
import { createUpdateSchema } from '@/server/services/contracts/item-inputs';
import { createUpdate, listItemUpdates } from '@/server/services/updates';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('itemId');

export const GET = withApi({ permission: 'update:read', params }, (ctx) =>
  listItemUpdates(svc(ctx), ctx.params.itemId),
);

export const POST = withApi(
  { permission: 'update:write', params, body: createUpdateSchema, maxBodyBytes: 512 * 1024 },
  async (ctx) => created(await createUpdate(svc(ctx), ctx.params.itemId, ctx.body)),
);
