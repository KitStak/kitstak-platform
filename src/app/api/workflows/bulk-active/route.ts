/** `POST /api/workflows/bulk-active { ids, isActive }` — bulk activate / deactivate. */
import { defineRoute } from "@/server/api/define-route";
import { bulkActiveSchema } from "@/lib/grid-defs/integrations/workflows";
import { setWorkflowsActive } from "@/server/repositories/workflows";

export const POST = defineRoute({
  permission: "automation.workflows.edit",
  body: bulkActiveSchema,
  handler: ({ db, auth, actor, body }) => setWorkflowsActive(db, auth, actor, body.ids, body.isActive),
});
