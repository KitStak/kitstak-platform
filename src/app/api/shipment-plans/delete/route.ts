/** `POST /api/shipment-plans/delete` `{ ids }` — bulk delete (Open plans only); per-id result. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { deletePlans } from "@/server/repositories/shipment-plans";

export const POST = defineRoute({
  permission: "fulfillment.shipment_plan.delete",
  body: z.object({ ids: bulkIdsSchema }),
  handler: ({ db, auth, actor, body }) => deletePlans(db, auth, domainCtx(actor, auth), body.ids),
});
