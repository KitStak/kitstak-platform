/** `POST /api/shipments/[id]/reprint` — a printable copy of the stored label. */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { reprintShipments } from "@/server/repositories/shipping";

export const POST = defineRoute({
  permission: "fulfillment.shipment_orders.reprint_label",
  params: idParamsSchema,
  transaction: false,
  handler: ({ db, auth, actor, params }) => reprintShipments(db, auth, domainCtx(actor, auth), [params.id]),
});
