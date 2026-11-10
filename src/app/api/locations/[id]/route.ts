/** `GET|PATCH /api/locations/[id]` — detail and edit (optimistic `version`). `DELETE` is guarded. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { locationSaveSchema } from "@/lib/grid-defs/facility/locations";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteLocations, getLocation, updateLocation } from "@/server/repositories/locations";

export const GET = defineRoute({
  permission: "settings.locations.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getLocation(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.locations.edit",
  params: idParamsSchema,
  body: locationSaveSchema,
  handler: ({ db, auth, actor, params, body }) => updateLocation(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.locations.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deleteLocations(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
