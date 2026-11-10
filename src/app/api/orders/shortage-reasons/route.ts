/**
 * `POST /api/orders/shortage-reasons` `{ ids }` — why each order can't be fully allocated
 * (locked / inactive location, damaged, count lock, allocation rule, other client). Read-only;
 * used by the Picking / job operations dry run and linked to Allocation Exceptions.
 */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { explainShortages, insightIdsSchema } from "@/server/repositories/orders-outbound-insights";

export const POST = defineRoute({
  permission: [ORDER_PERMISSIONS.jobs, ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  body: insightIdsSchema,
  transaction: false,
  rateLimit: false,
  handler: ({ db, auth, body }) => explainShortages(db, auth.scope, body.ids),
});
