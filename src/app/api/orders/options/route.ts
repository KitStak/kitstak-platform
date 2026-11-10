/** `GET /api/orders/options?warehouseId=&clientId=` — wizard / modal option lists (scoped). */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { orderFormOptions, orderOptionsQuerySchema } from "@/server/repositories/orders-options";

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.view,
  query: orderOptionsQuerySchema,
  handler: ({ db, auth, query }) => orderFormOptions(db, auth.scope, query),
});
