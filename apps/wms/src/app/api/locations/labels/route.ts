/** `POST /api/locations/labels { ids }` — records for the `location-label` printout (read-only). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { locationLabelRecords } from "@/server/repositories/locations";

export const POST = defineRoute({
  permission: "settings.locations.label",
  transaction: false,
  body: bulkIds,
  handler: async ({ db, auth, body }) => await locationLabelRecords(db, auth, body.ids),
});
