/** `POST /api/shortages/actions` `{ action: retry|backorder, ids }` (shortage line ids). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { createBackorders, retryAllocation, shortageOrderIds } from "@/server/repositories/waves";

export const POST = defineRoute({
  permission: "fulfillment.shipment_orders.picking_job_operations",
  body: z.object({ action: z.enum(["retry", "backorder"]), ids: bulkIdsSchema }),
  handler: ({ db, auth, actor, body }) => {
    const ctx = domainCtx(actor, auth);
    const orderIds = shortageOrderIds(db, body.ids);
    return body.action === "retry" ? retryAllocation(db, ctx, orderIds, auth.user.name) : createBackorders(db, ctx, orderIds);
  },
});
