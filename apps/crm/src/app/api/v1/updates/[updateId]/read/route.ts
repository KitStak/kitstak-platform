import { withApi } from '@/server/api';
import { markUpdatesRead } from '@/server/services/updates';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'update:read', rateLimit: 'default', params: uuidParams('updateId') },
  (ctx) => markUpdatesRead(svc(ctx), { updateId: ctx.params.updateId }),
);
