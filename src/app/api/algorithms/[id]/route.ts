/** `GET|PATCH|DELETE /api/algorithms/[id]` — editor load, save (optimistic `version`), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { algorithmSaveSchema } from "@/lib/grid-defs/integrations/algorithms";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteAlgorithms, getAlgorithm, updateAlgorithm } from "@/server/repositories/algorithms";

export const GET = defineRoute({
  permission: "automation.algorithms.view",
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getAlgorithm(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "automation.algorithms.edit",
  params: idParamsSchema,
  body: algorithmSaveSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateAlgorithm(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "automation.algorithms.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteAlgorithms(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
