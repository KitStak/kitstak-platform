/** `GET /api/workflows/[id]/change-log` — field-level history. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/integration-logs-kit";
import { loadWorkflow } from "@/server/repositories/workflows";

export const GET = defineRoute({
  permission: "automation.workflows.change_log",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadWorkflow(db, auth, params.id);
    return await changeLogResult(db, "workflow", params.id, query);
  },
});
