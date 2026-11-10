/** `POST /api/returns/[id]/label` — buy (or re-buy) the return label for an RMA. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { attachReturnLabel, RETURN_PERMISSIONS, returnLabelSchema, scopedCtx } from "@/server/repositories/returns";

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.returnLabel,
  transaction: false,
  params: idParamsSchema,
  body: returnLabelSchema,
  handler: async ({ db, auth, actor, params, body }) => created(await attachReturnLabel(db, scopedCtx(actor, auth), params.id, body)),
});
