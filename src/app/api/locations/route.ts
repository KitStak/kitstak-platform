/**
 * `GET /api/locations` — Locations grid (grid grammar: q/qm, f.*, sort, page, ps).
 * `POST /api/locations` — create a location with product + LP capacities.
 */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { locationSaveSchema } from "@/lib/grid-defs/facility/locations";
import { createLocation, listLocations } from "@/server/repositories/locations";

export const GET = defineRoute({
  permission: "settings.locations.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listLocations(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.locations.create",
  body: locationSaveSchema,
  handler: ({ db, auth, actor, body }) => created(createLocation(db, auth, actor, body)),
});
