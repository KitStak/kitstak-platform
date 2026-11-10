/**
 * `POST /api/shortages/actions` `{ action: retry|backorder, ids }` (shortage line ids).
 * Unknown, already-resolved or out-of-scope ids are reported per id in `failed[]` as NOT_FOUND
 * (same bulk contract as the jobs / tasks actions).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { createBackorders, resolveShortageIds, retryAllocation } from "@/server/repositories/waves";

export const POST = defineRoute({
  permission: "fulfillment.shipment_orders.picking_job_operations",
  body: z.object({ action: z.enum(["retry", "backorder"]), ids: bulkIdsSchema }),
  handler: ({ db, auth, actor, body }) => withM03Actor(db, actor, auth, () => {
    const ctx = domainCtx(actor, auth);
    const { orderIds, missing } = resolveShortageIds(db, auth, body.ids);
    const notFound = missing.map((id) => ({ id, code: "NOT_FOUND", message: "Shortage line not found (it may already be resolved)." }));
    if (orderIds.length === 0) return { succeeded: [] as string[], failed: notFound };
    const res = body.action === "retry" ? retryAllocation(db, ctx, orderIds, auth.user.name || auth.user.email) : createBackorders(db, ctx, orderIds);
    return { ...res, failed: [...res.failed, ...notFound] };
  }),
});
