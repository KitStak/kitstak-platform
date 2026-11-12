/** `POST /api/billing/duplicate { ids }` — copies each contract (as Draft) with every fee, tier and condition. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { duplicateContracts } from "@/server/repositories/billing";

export const POST = defineRoute({
  permission: "settings.billing.copy",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await duplicateContracts(db, auth, actor, body.ids),
});
