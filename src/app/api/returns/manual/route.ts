/** `POST /api/returns/manual` — Return Manually: creates a Manual RMA and receives it. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";
import { receiveManual, receiveManualSchema } from "@/server/repositories/returns-receive";

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  body: receiveManualSchema,
  handler: ({ db, auth, actor, body }) => {
    if (!can(auth, RETURN_PERMISSIONS.receive)) throw forbiddenError("You need the Execute Task permission to receive returns.");
    return created(receiveManual(db, scopedCtx(actor, auth), body));
  },
});
