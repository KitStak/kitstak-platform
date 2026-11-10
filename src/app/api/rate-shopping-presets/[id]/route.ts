/** `GET|PATCH|DELETE /api/rate-shopping-presets/[id]` — detail, edit (optimistic `version`), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { presetSaveSchema } from "@/lib/grid-defs/integrations/rate-shopping";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deletePresets, getPreset, updatePreset } from "@/server/repositories/rate-shopping";

export const GET = defineRoute({
  permission: "automation.rate_shopping.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getPreset(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "automation.rate_shopping.edit",
  params: idParamsSchema,
  body: presetSaveSchema,
  handler: ({ db, auth, actor, params, body }) => updatePreset(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "automation.rate_shopping.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deletePresets(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
