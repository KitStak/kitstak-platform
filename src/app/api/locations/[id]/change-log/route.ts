/**
 * `GET /api/locations/[id]/change-log` — field-level history for one location.
 * One rule across M10 entities: whoever can view the record can view its change log
 * (same keys as `GET /api/locations/[id]`); the record read also enforces warehouse scope.
 */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResultOrDeleted } from "@/server/repositories/locations-shared";
import { getLocation } from "@/server/repositories/locations";

export const GET = defineRoute({
  permission: ["settings.locations.view", "inventory.inventory_by_location.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    return changeLogResultOrDeleted(db, auth, "location", params.id, query, () => getLocation(db, auth, params.id));
  },
});
