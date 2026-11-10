/** `GET /api/shipments` — Carrier Shipment Details (grid grammar), one row per package/label. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listShipments } from "@/server/repositories/shipping";

export const GET = defineRoute({
  permission: "fulfillment.carrier_shipment_details.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listShipments(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
