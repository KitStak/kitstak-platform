import { withApi } from '@/server/api';
import { pinUpdateSchema } from '@/server/services/contracts/item-inputs';
import { pinUpdate } from '@/server/services/updates';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'update:write', params: uuidParams('updateId'), body: pinUpdateSchema },
  (ctx) => pinUpdate(svc(ctx), ctx.params.updateId, ctx.body.pinned),
);
