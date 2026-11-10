/** `POST /api/workflows/reorder { ids }` — drag sequence (evaluation order). */
import { defineRoute } from "@/server/api/define-route";
import { reorderSchema } from "@/lib/grid-defs/integrations/workflows";
import { reorderWorkflows } from "@/server/repositories/workflows";

export const POST = defineRoute({
  permission: "automation.workflows.edit",
  body: reorderSchema,
  handler: ({ db, auth, actor, body }) => reorderWorkflows(db, auth, actor, body.ids),
});
