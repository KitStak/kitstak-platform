/** `POST /api/work-orders/cancel-picking { ids }`: per-id BulkResult. */
import { defineRoute } from "@/server/api/define-route";
import { runBulk } from "@/server/domain";
import { idsBodySchema, WO_PERMISSIONS, woCtx } from "@/server/repositories/work-orders-api";
import { cancelPicking } from "@/server/repositories/work-orders-commands";

export const POST = defineRoute({
  permission: WO_PERMISSIONS.cancelPicking,
  body: idsBodySchema,
  handler: ({ db, auth, actor, body }) => {
    const ctx = woCtx(actor, auth);
    return runBulk(db, body.ids, (tx, id) => {
      cancelPicking(tx, ctx, id);
    });
  },
});
