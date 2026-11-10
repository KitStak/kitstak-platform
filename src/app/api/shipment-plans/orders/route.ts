/** `GET /api/shipment-plans/orders` — Shipment Plan Orders tab (grid grammar). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listPlanOrders } from "@/server/repositories/shipment-plans-lists";

export const GET = defineRoute({
  permission: "fulfillment.shipment_plan.view_plan_orders",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listPlanOrders(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
