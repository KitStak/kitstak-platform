import { withApi } from '@/server/api';
import { linkedItemsInputSchema, resolveLinkedItems } from '@/server/services/cells-support';
import { svc } from '../../_lib/route-helpers';

/** Batch-resolve linked item names for connect_boards cells (POST so long id lists fit). */
export const POST = withApi(
  { permission: 'item:read', planRead: true, body: linkedItemsInputSchema, rateLimit: 'default' },
  (ctx) => resolveLinkedItems(svc(ctx), ctx.body.itemIds),
);
