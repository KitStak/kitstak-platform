/** `POST /api/locations/labels { ids }` — records for the `location-label` printout (read-only). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { locationLabelRecords } from "@/server/repositories/locations";

export const POST = defineRoute({
  permission: "settings.locations.label",
  transaction: false,
  body: bulkIds,
  handler: ({ db, auth, body }) => locationLabelRecords(db, auth, body.ids),
});
