/** `POST /api/locations/bulk-lock { ids, locked }` — Lock / Unlock. */
import { defineRoute } from "@/server/api/define-route";
import { lockBodySchema } from "@/lib/grid-defs/facility/locations";
import { setLocationsLocked } from "@/server/repositories/locations";

export const POST = defineRoute({
  permission: "settings.locations.edit",
  body: lockBodySchema,
  handler: ({ db, auth, actor, body }) => setLocationsLocked(db, auth, actor, body.ids, body.locked),
});
