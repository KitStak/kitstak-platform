/** `POST /api/shipment-plans/[id]/ship` — ships every Ready to Ship order in the plan; partial results reported. */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { shipPlan } from "@/server/repositories/shipment-plans";

export const POST = defineRoute({
  permission: "fulfillment.shipment_plan.ship_order",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => await shipPlan(db, auth, domainCtx(actor, auth), params.id),
});
