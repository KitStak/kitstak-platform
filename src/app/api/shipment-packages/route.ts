/** `GET /api/shipment-packages` — Shipment Packages grid (grid grammar). `POST` — create (4-step wizard). */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { shipmentPackageSchema } from "@/lib/grid-defs/facility/shipment-packages";
import { createShipmentPackage, listShipmentPackages } from "@/server/repositories/shipment-packages";

export const GET = defineRoute({
  permission: ["settings.shipment_packages.view", "inventory.inventory_by_location.view"],
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listShipmentPackages(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.shipment_packages.create",
  body: shipmentPackageSchema,
  handler: async ({ db, auth, actor, body }) => created(await createShipmentPackage(db, auth, actor, body)),
});
