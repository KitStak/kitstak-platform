/** `PATCH /api/shipment-plans/[id]/quick` — inline grid edit of truck plate, gate and loading times (version-checked). */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { quickPlanSchema, quickUpdatePlan } from "@/server/repositories/shipment-plans";

export const PATCH = defineRoute({
  permission: "fulfillment.shipment_plan.edit",
  params: idParamsSchema,
  body: quickPlanSchema,
  handler: ({ db, auth, actor, params, body }) => quickUpdatePlan(db, auth, domainCtx(actor, auth), params.id, body),
});
