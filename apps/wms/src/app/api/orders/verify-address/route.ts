/** `POST /api/orders/verify-address` — offline address verification for the create wizard (nothing is written). */
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { addressCheckSchema, checkAddress } from "@/server/repositories/orders-commands";

export const POST = defineRoute({
  permission: [ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  body: addressCheckSchema,
  transaction: false,
  rateLimit: false,
  handler: ({ body }) => checkAddress(body),
});
