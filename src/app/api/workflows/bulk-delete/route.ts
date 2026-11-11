/** `POST /api/workflows/bulk-delete { ids }` — per-id result; in-use workflows are skipped with a reason. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/integrations/common";
import { deleteWorkflows } from "@/server/repositories/workflows";

export const POST = defineRoute({
  permission: "automation.workflows.delete",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteWorkflows(db, auth, actor, body.ids),
});
