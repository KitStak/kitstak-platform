/** `POST /api/shipments/tracking` `{ ids }` — Refresh tracking: carrier status, actual pickup and delivery date per package. */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx } from "@/server/repositories/platform-common";
import { refreshTracking, refreshTrackingSchema } from "@/server/repositories/shipping-carrier-ops";

export const POST = defineRoute({
  permission: ["fulfillment.shipment_orders.create_label", "fulfillment.shipment_orders.reprint_label"],
  body: refreshTrackingSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body }) => await refreshTracking(db, auth, domainCtx(actor, auth), body.ids),
});
