/** `GET /api/orders/[id]/ledger` — inventory transactions + allocations for the activity timeline (scoped). */
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { findOrderRow } from "@/server/repositories/orders";
import { orderLedger } from "@/server/repositories/orders-wizard";
import { idParamsSchema } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.view,
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => {
    const order = await findOrderRow(db, auth.viewScope, params.id);
    if (!order) throw notFoundError("Shipment order");
    return await orderLedger(db, order.id);
  },
});
