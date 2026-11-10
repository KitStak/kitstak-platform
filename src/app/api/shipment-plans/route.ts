/** `GET /api/shipment-plans` (grid grammar) · `POST` create a plan (3-step drawer). */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { domainCtx } from "@/server/repositories/platform-common";
import { createPlan, createPlanSchema } from "@/server/repositories/shipment-plans";
import { listPlans } from "@/server/repositories/shipment-plans-lists";

export const GET = defineRoute({
  permission: "fulfillment.shipment_plan.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listPlans(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "fulfillment.shipment_plan.create",
  body: createPlanSchema,
  handler: ({ db, auth, actor, body }) => created(createPlan(db, auth, domainCtx(actor, auth), body)),
});
