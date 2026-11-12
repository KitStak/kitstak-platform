/**
 * `POST /api/packing/complete` — Complete Packing (And Create Label) / Pack Without Label:
 * ledger Packing, labels (multi-box), packing slip, auto-ship, packaging consumption.
 */
import { defineRoute } from "@/server/api/define-route";
import { forbiddenError } from "@/server/api/errors";
import { can } from "@/server/auth/permissions";
import { completePacking, completePackingSchema } from "@/server/repositories/packing";
import { PACKING_PERMISSIONS } from "@/server/repositories/packing-scan";
import { scopedCtx } from "@/server/repositories/returns";

export const POST = defineRoute({
  // Execute key at route level: callers who can't pack get 403 before the body is validated.
  permission: PACKING_PERMISSIONS.execute,
  transaction: false,
  body: completePackingSchema,
  handler: async ({ db, auth, actor, body }) => {
    if (!can(auth, PACKING_PERMISSIONS.view)) throw forbiddenError("You need access to the Packing Station to pack orders.");
    if (body.withLabel && !can(auth, PACKING_PERMISSIONS.createLabel)) throw forbiddenError("You need the Create Label permission to print shipping labels.");
    return completePacking(db, scopedCtx(actor, auth), body);
  },
});
