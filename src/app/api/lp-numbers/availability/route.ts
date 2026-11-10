/** `GET /api/lp-numbers/availability?warehouseId=&code=&alternateBarcode=&excludeId=` — is a custom LP number still free in this warehouse? */
import { defineRoute } from "@/server/api/define-route";
import { availabilityQuerySchema, checkAvailability } from "@/server/repositories/locations-availability";

export const GET = defineRoute({
  permission: ["settings.lp_numbers.create", "settings.lp_numbers.edit"],
  query: availabilityQuerySchema,
  handler: ({ db, auth, query }) => checkAvailability(db, auth, "lp_number", query),
});
