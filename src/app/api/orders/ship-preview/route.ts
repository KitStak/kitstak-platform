/** `POST /api/orders/ship-preview` `{ ids }` — partial-shipment notes for the Ship order confirm/result. Read-only. */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { insightIdsSchema, shipPreview } from "@/server/repositories/orders-outbound-insights";

export const POST = defineRoute({
  permission: ORDER_PERMISSIONS.ship,
  body: insightIdsSchema,
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, body }) => await shipPreview(db, auth.scope, body.ids),
});
