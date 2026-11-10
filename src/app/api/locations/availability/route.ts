/** `GET /api/locations/availability?warehouseId=&code=&excludeId=` — is the code still free? (wizard step 1 pre-check). */
import { defineRoute } from "@/server/api/define-route";
import { availabilityQuerySchema, checkAvailability } from "@/server/repositories/locations-availability";

export const GET = defineRoute({
  permission: ["settings.locations.create", "settings.locations.edit"],
  query: availabilityQuerySchema,
  handler: ({ db, auth, query }) => checkAvailability(db, auth, "location", query),
});
