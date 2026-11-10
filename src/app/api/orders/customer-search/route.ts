/** `GET /api/orders/customer-search?clientId=&q=` — Step 2 customer search: saved customers + one-time customers from the client's orders (scoped). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { customerSearch } from "@/server/repositories/orders-wizard";

export const GET = defineRoute({
  permission: [ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  query: z.object({ clientId: z.string().trim().min(1).max(64), q: z.string().trim().max(100).default("") }),
  handler: ({ db, auth, query }) => ({ items: customerSearch(db, auth.scope, query.clientId, query.q) }),
});
