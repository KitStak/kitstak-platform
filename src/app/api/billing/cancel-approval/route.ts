/** `POST /api/billing/cancel-approval { ids }` — Actions › Cancel Approval (back to Draft). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { cancelContractApprovals } from "@/server/repositories/billing";

export const POST = defineRoute({
  permission: "settings.billing.edit",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await cancelContractApprovals(db, auth, actor, body.ids),
});
