/** `POST /api/billing/approve { ids }` — Actions › Approve (contracts need at least one fee). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { approveContracts } from "@/server/repositories/billing";

export const POST = defineRoute({
  permission: "settings.billing.edit",
  body: bulkIds,
  handler: ({ db, auth, actor, body }) => approveContracts(db, auth, actor, body.ids),
});
