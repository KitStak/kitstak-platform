/** `POST /api/shipment-packages/bulk-delete { ids }` — per-id result; packages already used are skipped. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { deleteShipmentPackages } from "@/server/repositories/shipment-packages";

export const POST = defineRoute({
  permission: "settings.shipment_packages.delete",
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteShipmentPackages(db, auth, actor, body.ids),
});
