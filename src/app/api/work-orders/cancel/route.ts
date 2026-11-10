/** `POST /api/work-orders/cancel { ids }`: cancel work orders (releases allocations, tasks, job). Per-id BulkResult. */
import { defineRoute } from "@/server/api/define-route";
import { runBulk } from "@/server/domain";
import { idsBodySchema, WO_PERMISSIONS, woCtx } from "@/server/repositories/work-orders-api";
import { cancelWorkOrder } from "@/server/repositories/work-orders-commands";

export const POST = defineRoute({
  permission: WO_PERMISSIONS.edit,
  body: idsBodySchema,
  handler: ({ db, auth, actor, body }) => {
    const ctx = woCtx(actor, auth);
    return runBulk(db, body.ids, (tx, id) => {
      cancelWorkOrder(tx, ctx, id);
    });
  },
});
