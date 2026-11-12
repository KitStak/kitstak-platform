/** `POST /api/shipments/void` `{ ids }` — bulk void; per-id result. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsSchema, domainCtx } from '@/server/repositories/platform-common';
import { voidShipments } from '@/server/repositories/shipping';

export const POST = defineRoute({
  permission: 'fulfillment.shipment_orders.void_label',
  body: z.object({ ids: bulkIdsSchema }),
  transaction: false,
  handler: ({ db, auth, actor, body }) => voidShipments(db, auth, domainCtx(actor, auth), body.ids),
});
