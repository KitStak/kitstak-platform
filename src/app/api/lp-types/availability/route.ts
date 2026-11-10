/** `GET /api/lp-types/availability?warehouseId=&code=&prefix=&excludeId=` — is the code / prefix still free? (wizard step 1 pre-check). */
import { defineRoute } from "@/server/api/define-route";
import { availabilityQuerySchema, checkAvailability } from "@/server/repositories/locations-availability";

export const GET = defineRoute({
  permission: ["settings.lp_types.create", "settings.lp_types.edit"],
  query: availabilityQuerySchema,
  handler: ({ db, auth, query }) => checkAvailability(db, auth, "lp_type", query),
});
