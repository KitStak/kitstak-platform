/** `GET /api/shipment-plans/orders` — Shipment Plan Orders tab (grid grammar). */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { listPlanOrders } from '@/server/repositories/shipment-plans-lists';

export const GET = defineRoute({
  // Any-of: the plan view permission covers every read-only Shipment Plan tab (Logiwa parity, REQ-6).
  permission: ['fulfillment.shipment_plan.view_plan_orders', 'fulfillment.shipment_plan.view'],
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listPlanOrders(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
