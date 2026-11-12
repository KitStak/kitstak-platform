/** `POST /api/shipments/reprint` `{ ids }` — merges the selected labels into one printable file. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsSchema, domainCtx } from '@/server/repositories/platform-common';
import { reprintShipments } from '@/server/repositories/shipping';

export const POST = defineRoute({
  permission: 'fulfillment.shipment_orders.reprint_label',
  body: z.object({ ids: bulkIdsSchema }),
  transaction: false,
  handler: ({ db, auth, actor, body }) => reprintShipments(db, auth, domainCtx(actor, auth), body.ids),
});
