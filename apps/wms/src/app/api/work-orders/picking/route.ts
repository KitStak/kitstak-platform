/**
 * `POST /api/work-orders/picking { ids, jobTypeId?, assigneeUserId?, priority?, dryRun? }`:
 * Picking/Job Operations. Allocates components and creates Work Order Picking jobs; short
 * work orders become Shortage with "Manual Allocation - Work Order" allocation exceptions.
 */
import { defineRoute } from "@/server/api/define-route";
import { pickingBodySchema, WO_PERMISSIONS, woCtx } from "@/server/repositories/work-orders-api";
import { runPicking } from "@/server/repositories/work-orders-ops";

export const POST = defineRoute({
  permission: WO_PERMISSIONS.picking,
  body: pickingBodySchema,
  handler: async ({ db, auth, actor, body }) => await runPicking(db, woCtx(actor, auth), {
    ids: body.ids, jobTypeId: body.jobTypeId, assigneeUserId: body.assigneeUserId, priority: body.priority, dryRun: body.dryRun,
  }),
});
