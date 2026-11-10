/** `POST /api/purchase-orders/[id]/cancel` — Cancel Order (Pending / Started only, no active receipts). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { getPurchaseOrder } from "@/server/repositories/purchase-orders";
import { cancelPurchaseOrder } from "@/server/repositories/purchase-orders-commands";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.cancel_order",
  params: idParamsSchema,
  body: z.object({ version: z.number().int().min(1).optional() }),
  handler: ({ db, auth, actor, params, body }) => {
    cancelPurchaseOrder(db, domainCtx(actor, auth), auth.scope, params.id, body.version);
    return getPurchaseOrder(db, auth.scope, params.id);
  },
});
