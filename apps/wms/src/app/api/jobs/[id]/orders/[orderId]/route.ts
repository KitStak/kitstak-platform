/** `DELETE /api/jobs/[id]/orders/[orderId]` — removes a not-yet-started order from the job (keeps its allocation). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { domainCtx, idSchema } from "@/server/repositories/platform-common";
import { assertJobAction } from "@/server/repositories/jobs-policy";
import { JOB_PERMISSIONS, getJobDetail, removeOrder } from "@/server/repositories/jobs";

export const DELETE = defineRoute({
  permission: JOB_PERMISSIONS.cancel,
  params: z.object({ id: idSchema, orderId: idSchema }),
  handler: async ({ db, auth, actor, params }) => await withM03Actor(db, actor, auth, async () => {
    assertJobAction(auth, JOB_PERMISSIONS.cancel);
    await removeOrder(db, domainCtx(actor, auth), params.id, params.orderId);
    return await getJobDetail(db, auth, params.id);
  }),
});
