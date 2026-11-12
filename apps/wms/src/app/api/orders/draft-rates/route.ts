/** `POST /api/orders/draft-rates` — Step 4 "Get rates" for an order that is not saved yet (nothing is written). */
import { defineRoute } from '@/server/api/define-route';
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { draftRates, draftRatesSchema } from '@/server/repositories/orders-wizard';

export const POST = defineRoute({
  permission: [ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  body: draftRatesSchema,
  transaction: false,
  handler: ({ db, auth, body }) => draftRates(db, auth.scope, body),
});
