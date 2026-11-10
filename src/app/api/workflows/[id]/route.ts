/** `GET|PATCH|DELETE /api/workflows/[id]` — detail, edit (optimistic `version`), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { workflowSaveSchema } from "@/lib/grid-defs/integrations/workflows";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteWorkflows, getWorkflow, updateWorkflow } from "@/server/repositories/workflows";

export const GET = defineRoute({
  permission: "automation.workflows.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getWorkflow(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "automation.workflows.edit",
  params: idParamsSchema,
  body: workflowSaveSchema,
  handler: ({ db, auth, actor, params, body }) => updateWorkflow(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "automation.workflows.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deleteWorkflows(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
