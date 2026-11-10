/** `POST /api/returns/receive` — receive RMA items at the Return Station (ledger Return Receiving). */
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";
import { receiveRma, receiveRmaSchema } from "@/server/repositories/returns-receive";

export const POST = defineRoute({
  // Route-level gate is the execute key, so callers without it get 403 before the body is
  // validated (no schema disclosure). Station access is checked next, still before any write.
  permission: RETURN_PERMISSIONS.receive,
  body: receiveRmaSchema,
  handler: ({ db, auth, actor, body }) => {
    if (!can(auth, RETURN_PERMISSIONS.station)) throw forbiddenError("You need access to the Return Station to receive returns.");
    return receiveRma(db, scopedCtx(actor, auth), body);
  },
});
