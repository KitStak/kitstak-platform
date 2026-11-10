/** `GET /api/shipments/[id]` — one package/label with its items and sibling packages. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getShipment } from "@/server/repositories/shipping";

export const GET = defineRoute({
  permission: "fulfillment.carrier_shipment_details.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getShipment(db, auth, params.id),
});
