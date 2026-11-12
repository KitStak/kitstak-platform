/** `POST /api/returns/[id]/label` — buy (or re-buy) the return label; `DELETE` — void it (carrier void + RMA tracking cleared). */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { attachReturnLabel, RETURN_PERMISSIONS, returnLabelSchema, scopedCtx, voidReturnLabel } from "@/server/repositories/returns";

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.returnLabel,
  transaction: false,
  params: idParamsSchema,
  body: returnLabelSchema,
  handler: async ({ db, auth, actor, params, body }) => created(await attachReturnLabel(db, scopedCtx(actor, auth), params.id, body)),
});

export const DELETE = defineRoute({
  permission: RETURN_PERMISSIONS.returnLabel,
  transaction: false,
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => voidReturnLabel(db, scopedCtx(actor, auth), params.id),
});
