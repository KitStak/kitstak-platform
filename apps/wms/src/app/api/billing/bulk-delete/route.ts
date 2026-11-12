/** `POST /api/billing/bulk-delete { ids }` — Actions › Delete; approved contracts and contracts with bills are skipped. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { deleteContracts } from "@/server/repositories/billing";

export const POST = defineRoute({
  permission: "settings.billing.delete",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteContracts(db, auth, actor, body.ids),
});
