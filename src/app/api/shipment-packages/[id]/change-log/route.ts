/** `GET /api/shipment-packages/[id]/change-log` — field-level history (no catalog change-log key for packages; view gates it). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/locations-shared";
import { loadShipmentPackage } from "@/server/repositories/shipment-packages";

export const GET = defineRoute({
  permission: "settings.shipment_packages.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadShipmentPackage(db, auth, params.id);
    return changeLogResult(db, "shipment_package", params.id, query);
  },
});
