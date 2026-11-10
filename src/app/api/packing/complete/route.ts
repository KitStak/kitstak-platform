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
  permission: [PACKING_PERMISSIONS.view],
  transaction: false,
  body: completePackingSchema,
  handler: async ({ db, auth, actor, body }) => {
    if (!can(auth, PACKING_PERMISSIONS.execute)) throw forbiddenError("You need the Execute Task permission to pack orders.");
    if (body.withLabel && !can(auth, PACKING_PERMISSIONS.createLabel)) throw forbiddenError("You need the Create Label permission to print shipping labels.");
    return completePacking(db, scopedCtx(actor, auth), body);
  },
});
