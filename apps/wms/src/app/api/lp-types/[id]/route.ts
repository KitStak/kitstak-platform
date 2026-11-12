/** `GET|PATCH|DELETE /api/lp-types/[id]` — detail, edit (optimistic `version`), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { lpTypeSchema } from "@/lib/grid-defs/facility/lp-types";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteLpTypes, getLpType, updateLpType } from "@/server/repositories/lp-types";

export const GET = defineRoute({
  permission: ["settings.lp_types.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getLpType(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.lp_types.edit",
  params: idParamsSchema,
  body: lpTypeSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateLpType(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.lp_types.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteLpTypes(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
