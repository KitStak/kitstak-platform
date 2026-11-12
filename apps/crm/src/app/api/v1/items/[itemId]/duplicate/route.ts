import { withApi } from '@/server/api';
import { duplicateItemSchema } from '@/server/services/contracts/item-inputs';
import { duplicateItem } from '@/server/services/items';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

export const POST = withApi(
  { permission: 'item:write', params: uuidParams('itemId'), body: duplicateItemSchema.optional() },
  async (ctx) =>
    created(
      await duplicateItem(
        svc(ctx),
        ctx.params.itemId,
        ctx.body ?? { withSubitems: true, withUpdates: false },
      ),
    ),
);
