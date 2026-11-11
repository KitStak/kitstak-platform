/**
 * `POST /api/returns/[id]/reopen` — reopen a short-closed RMA (Completed with units still
 * outstanding) so the rest can be received. Supervisor action: needs Change Status.
 */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";
import { reopenReturn, reopenReturnSchema } from "@/server/repositories/returns-receive";

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.changeStatus,
  params: idParamsSchema,
  body: reopenReturnSchema,
  handler: async ({ db, auth, actor, params, body }) => await reopenReturn(db, scopedCtx(actor, auth), params.id, body),
});
