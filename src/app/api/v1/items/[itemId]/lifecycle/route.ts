import { z } from 'zod';
import { withApi } from '@/server/api';
import { changeItemLifecycle } from '@/server/services/items';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Archive or restore (from archive or trash). */
export const POST = withApi(
  {
    permission: 'item:write',
    params: uuidParams('itemId'),
    body: z.object({ action: z.enum(['archive', 'restore']) }),
  },
  (ctx) => changeItemLifecycle(svc(ctx), ctx.params.itemId, ctx.body.action),
);
