/** `GET|PATCH /api/locations/[id]` — detail and partial edit (merge; optimistic `version`). `DELETE` is guarded. */
import { defineRoute } from "@/server/api/define-route";
import { AppError, fromZodError } from "@/server/api/errors";
import { locationPatchSchema, locationSaveSchema, mergeLocationPatch } from "@/lib/grid-defs/facility/locations";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteLocations, getLocation, updateLocation } from "@/server/repositories/locations";

export const GET = defineRoute({
  permission: ["settings.locations.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getLocation(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.locations.edit",
  params: idParamsSchema,
  body: locationPatchSchema,
  /** Partial update: the body is merged onto the stored record, then validated as a whole. */
  handler: async ({ db, auth, actor, params, body }) => {
    const merged = locationSaveSchema.safeParse(mergeLocationPatch(await getLocation(db, auth, params.id), body));
    if (!merged.success) throw fromZodError(merged.error);
    return await updateLocation(db, auth, actor, params.id, merged.data);
  },
});

export const DELETE = defineRoute({
  permission: "settings.locations.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteLocations(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
