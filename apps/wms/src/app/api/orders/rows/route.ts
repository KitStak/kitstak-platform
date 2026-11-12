/** `POST /api/orders/rows` `{ ids }` — grid rows for a selection (confirm tables, eligibility). Read-only. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { ordersByIds } from '@/server/repositories/orders';
import { bulkIdsSchema } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: ORDER_PERMISSIONS.view,
  body: z.object({ ids: bulkIdsSchema }),
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, body }) => await ordersByIds(db, auth.scope, body.ids),
});
