/** `POST /api/allocation-exceptions/retry` `{ ids }` (exception ids) — re-runs allocation for their orders. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { orderIdsOfExceptions, retryAllocation } from "@/server/repositories/waves";

export const POST = defineRoute({
  permission: "fulfillment.shipment_orders.picking_job_operations",
  body: z.object({ ids: bulkIdsSchema }),
  handler: async ({ db, auth, actor, body }) => await withM03Actor(db, actor, auth, async () => await retryAllocation(db, domainCtx(actor, auth), await orderIdsOfExceptions(db, body.ids), auth.user.name || auth.user.email)),
});
