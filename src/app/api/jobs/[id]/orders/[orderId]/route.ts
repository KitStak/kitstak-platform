/** `DELETE /api/jobs/[id]/orders/[orderId]` — removes a not-yet-started order from the job (keeps its allocation). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idSchema } from "@/server/repositories/platform-common";
import { JOB_PERMISSIONS, getJobDetail, removeOrder } from "@/server/repositories/jobs";

export const DELETE = defineRoute({
  permission: JOB_PERMISSIONS.cancel,
  params: z.object({ id: idSchema, orderId: idSchema }),
  handler: ({ db, auth, actor, params }) => {
    removeOrder(db, domainCtx(actor, auth), params.id, params.orderId);
    return getJobDetail(db, auth, params.id);
  },
});
