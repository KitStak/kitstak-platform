/** `GET /api/orders/customer-prefill?customerId=` — Step 2 prefill: customer contact + saved addresses (scoped). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { customerPrefill } from "@/server/repositories/orders-wizard";

export const GET = defineRoute({
  permission: [ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  query: z.object({ customerId: z.string().trim().min(1).max(64) }),
  handler: async ({ db, auth, query }) => {
    const result = await customerPrefill(db, auth.scope, query.customerId);
    if (!result) throw notFoundError("Customer");
    return result;
  },
});
