/** `POST /api/returns/receive` — receive RMA items at the Return Station (ledger Return Receiving). */
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";
import { receiveRma, receiveRmaSchema } from "@/server/repositories/returns-receive";

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  body: receiveRmaSchema,
  handler: ({ db, auth, actor, body }) => {
    if (!can(auth, RETURN_PERMISSIONS.receive)) throw forbiddenError("You need the Execute Task permission to receive returns.");
    return receiveRma(db, scopedCtx(actor, auth), body);
  },
});
