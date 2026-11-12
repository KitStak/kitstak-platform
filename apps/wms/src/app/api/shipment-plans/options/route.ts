/** `GET /api/shipment-plans/options?warehouseId=&customerId=` — drawer options (next code, carriers, retailers, customer addresses). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { idSchema } from '@/server/repositories/platform-common';
import { planFormOptions } from '@/server/repositories/shipment-plans';

export const GET = defineRoute({
  permission: ['fulfillment.shipment_plan.create', 'fulfillment.shipment_plan.edit'],
  query: z.object({ warehouseId: idSchema.optional(), customerId: idSchema.optional() }),
  handler: async ({ db, auth, query }) => await planFormOptions(db, auth, query),
});
