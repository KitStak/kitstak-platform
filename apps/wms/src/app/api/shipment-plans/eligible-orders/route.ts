/** `GET /api/shipment-plans/eligible-orders?warehouseId=&clientId=&planId=` — orders that can join a plan (grid grammar). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { idSchema } from '@/server/repositories/platform-common';
import { listEligibleOrders } from '@/server/repositories/shipment-plans-lists';

export const GET = defineRoute({
  permission: ['fulfillment.shipment_plan.create', 'fulfillment.shipment_plan.edit'],
  query: z
    .object({ warehouseId: idSchema, clientId: idSchema.optional(), planId: idSchema.optional() })
    .loose(),
  handler: async ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total } = await listEligibleOrders(db, auth, q, query);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
