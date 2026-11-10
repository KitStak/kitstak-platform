/** `GET /api/warehouses/availability?code=&excludeId=` — is the code still free? (wizard step 1 pre-check). */
import { defineRoute } from "@/server/api/define-route";
import { availabilityQuerySchema, checkAvailability } from "@/server/repositories/locations-availability";

export const GET = defineRoute({
  permission: ["settings.warehouse.create", "settings.warehouse.edit"],
  query: availabilityQuerySchema,
  handler: ({ db, auth, query }) => checkAvailability(db, auth, "warehouse", query),
});
