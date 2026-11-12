/** `GET /api/shipments/facets` — scoped filter values for the M02 grids. */
import { defineRoute } from '@/server/api/define-route';
import { shippingFacets } from '@/server/repositories/shipping';

export const GET = defineRoute({
  permission: [
    'fulfillment.carrier_shipment_details.view',
    'fulfillment.end_of_day.view',
    'fulfillment.shipment_history.view',
    'fulfillment.shipment_plan.view',
  ],
  handler: async ({ db, auth }) => await shippingFacets(db, auth.viewScope),
});
