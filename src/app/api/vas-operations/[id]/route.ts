/** `GET|PATCH|DELETE /api/vas-operations/[id]` — detail, edit (optimistic `version`), delete (locked inside an approved bill). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { vasSchema } from "@/lib/grid-defs/organization/vas";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteVas, getVas, updateVas } from "@/server/repositories/vas";

export const GET = defineRoute({
  permission: "settings.vas_operations.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getVas(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.vas_operations.edit",
  params: idParamsSchema,
  body: vasSchema,
  handler: ({ db, auth, actor, params, body }) => updateVas(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.vas_operations.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deleteVas(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
