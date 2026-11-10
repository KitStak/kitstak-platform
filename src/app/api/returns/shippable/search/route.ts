/** `GET /api/returns/shippable/search?q=&clientId=&warehouseId=` — shipped orders to return, newest first. */
import { defineRoute } from "@/server/api/define-route";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";
import { searchShippedOrders, shippedSearchSchema } from "@/server/repositories/returns-search";

export const GET = defineRoute({
  permission: [RETURN_PERMISSIONS.createRma, RETURN_PERMISSIONS.receive],
  query: shippedSearchSchema,
  handler: ({ db, auth, query }) => searchShippedOrders(db, auth.scope, query),
});
