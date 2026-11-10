/** `GET /api/orders/job-options?warehouseId=` — Picking/Job Operations modal: picking job types + mergeable pending jobs. */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { jobOptionsQuerySchema, orderJobOptions } from "@/server/repositories/orders-options";

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.jobs,
  query: jobOptionsQuerySchema,
  handler: ({ db, auth, query }) => orderJobOptions(db, auth.scope, query.warehouseId),
});
