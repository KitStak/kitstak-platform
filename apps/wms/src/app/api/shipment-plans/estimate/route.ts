/** `GET /api/shipment-plans/estimate?orderIds=a,b` — expected weight (lb) / volume (ft³) from the orders. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { estimateTotals } from '@/server/repositories/shipment-plans';

export const GET = defineRoute({
  permission: ['fulfillment.shipment_plan.create', 'fulfillment.shipment_plan.edit'],
  query: z.object({
    orderIds: z
      .string()
      .max(40_000)
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().max(64)).max(500)),
  }),
  handler: async ({ db, auth, query }) => await estimateTotals(db, auth, query.orderIds),
});
