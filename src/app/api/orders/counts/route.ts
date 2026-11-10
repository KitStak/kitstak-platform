/** `GET /api/orders/counts` — `{ backlog, shipped }` for the route tab badges. */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { orderViewCounts } from "@/server/repositories/orders";

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.view,
  handler: ({ db, auth }) => orderViewCounts(db, auth.viewScope),
});
