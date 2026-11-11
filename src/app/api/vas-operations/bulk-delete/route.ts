/** `POST /api/vas-operations/bulk-delete { ids }` — per-id result; operations inside approved bills are skipped. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { deleteVas } from "@/server/repositories/vas";

export const POST = defineRoute({
  permission: "settings.vas_operations.delete",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteVas(db, auth, actor, body.ids),
});
