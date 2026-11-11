/**
 * `POST /api/billing/approve { ids }` — Actions › Approve (contracts need at least one fee).
 * 200 with a succeeded/failed split when anything was approved; 409 INVALID_STATE when nothing was.
 */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { approveContracts } from "@/server/repositories/billing";

export const POST = defineRoute({
  permission: "settings.billing.edit",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => {
    const result = await approveContracts(db, auth, actor, body.ids);
    // Nothing approved (e.g. a single contract with no fees): a real 409, not a 200 with a failure list.
    const first = result.failed[0];
    if (result.succeeded.length === 0 && first) throw new AppError("INVALID_STATE", first.message);
    return result;
  },
});
