/** `POST|DELETE /api/shipment-plans/[id]/orders` `{ orderIds }` — add / remove plan orders. */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { addPlanOrders, planOrdersSchema, removePlanOrders } from "@/server/repositories/shipment-plans";

export const POST = defineRoute({
  permission: "fulfillment.shipment_plan.edit",
  params: idParamsSchema,
  body: planOrdersSchema,
  handler: async ({ db, auth, actor, params, body }) => await addPlanOrders(db, auth, domainCtx(actor, auth), params.id, body.orderIds),
});

export const DELETE = defineRoute({
  permission: "fulfillment.shipment_plan.edit",
  params: idParamsSchema,
  body: planOrdersSchema,
  handler: async ({ db, auth, actor, params, body }) => await removePlanOrders(db, auth, domainCtx(actor, auth), params.id, body.orderIds),
});
