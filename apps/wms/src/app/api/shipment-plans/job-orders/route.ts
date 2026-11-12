/** `POST /api/shipment-plans/job-orders` `{ ids }` — the unshipped order ids of plans, for Picking/Job Operations. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsSchema } from '@/server/repositories/platform-common';
import { planJobOrders } from '@/server/repositories/shipment-plans';

export const POST = defineRoute({
  permission: 'fulfillment.shipment_plan.picking_operations',
  body: z.object({ ids: bulkIdsSchema }),
  handler: async ({ db, auth, body }) => await planJobOrders(db, auth, body.ids),
});
