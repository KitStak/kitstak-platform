/** `POST /api/purchase-orders/[id]/status` — manual status change (allowed transitions only, with a reason). */
import { defineRoute } from "@/server/api/define-route";
import { poStatusChangeSchema } from "@/lib/grid-defs/receiving/po-schemas";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { changePurchaseOrderStatus } from "@/server/repositories/purchase-orders-commands";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.change_status",
  params: idParamsSchema,
  body: poStatusChangeSchema,
  handler: async ({ db, auth, actor, params, body }) => await changePurchaseOrderStatus(db, domainCtx(actor, auth), auth.scope, params.id, body),
});
