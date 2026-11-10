/** `PATCH /api/returns/[id]/info` — edit one RMA's return info (carrier, option, cost, tracking numbers). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { editReturnInfo, editReturnInfoSchema, RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";

export const PATCH = defineRoute({
  permission: RETURN_PERMISSIONS.changeStatus,
  params: idParamsSchema,
  body: editReturnInfoSchema,
  handler: ({ db, auth, actor, params, body }) => editReturnInfo(db, scopedCtx(actor, auth), params.id, body),
});
