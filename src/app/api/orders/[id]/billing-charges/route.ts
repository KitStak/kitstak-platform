/** `GET /api/orders/[id]/billing-charges` — billing report lines that reference the order (Download billing charges). */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { orderBillingCharges } from "@/server/repositories/orders-commands";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.billing,
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => await orderBillingCharges(db, domainCtx(actor, auth), params.id),
});
