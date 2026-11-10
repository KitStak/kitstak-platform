/** `POST /api/allocation-exceptions/retry` `{ ids }` (exception ids) — re-runs allocation for their orders. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { orderIdsOfExceptions, retryAllocation } from "@/server/repositories/waves";

export const POST = defineRoute({
  permission: "fulfillment.shipment_orders.picking_job_operations",
  body: z.object({ ids: bulkIdsSchema }),
  handler: ({ db, auth, actor, body }) => retryAllocation(db, domainCtx(actor, auth), orderIdsOfExceptions(db, body.ids), auth.user.name),
});
