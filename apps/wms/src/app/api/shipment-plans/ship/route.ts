/** `POST /api/shipment-plans/ship` `{ ids }` — bulk Ship; per-plan result with order outcomes. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsSchema, domainCtx } from '@/server/repositories/platform-common';
import { shipPlans } from '@/server/repositories/shipment-plans';

export const POST = defineRoute({
  permission: 'fulfillment.shipment_plan.ship_order',
  body: z.object({ ids: bulkIdsSchema }),
  handler: async ({ db, auth, actor, body }) => await shipPlans(db, auth, domainCtx(actor, auth), body.ids),
});
