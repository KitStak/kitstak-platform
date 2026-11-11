/** `POST /api/orders/[id]/duplicate` — copies the order (header + lines) into a new Open order. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { duplicateOrder } from "@/server/repositories/orders-commands";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: ORDER_PERMISSIONS.create,
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => created(await duplicateOrder(db, domainCtx(actor, auth), params.id)),
});
