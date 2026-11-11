/** `/api/purchase-orders/[id]` — detail, edit (optimistic `version`) and delete (Pending, no receipts). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { poUpdateSchema } from "@/lib/grid-defs/receiving/po-schemas";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { getPurchaseOrder } from "@/server/repositories/purchase-orders";
import { deletePurchaseOrder, updatePurchaseOrder } from "@/server/repositories/purchase-orders-commands";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.view",
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getPurchaseOrder(db, auth.scope, params.id),
});

export const PATCH = defineRoute({
  permission: "inventory.purchase_orders.edit",
  params: idParamsSchema,
  body: poUpdateSchema,
  handler: async ({ db, auth, actor, params, body }) => await updatePurchaseOrder(db, domainCtx(actor, auth), auth.scope, params.id, body),
});

export const DELETE = defineRoute({
  permission: "inventory.purchase_orders.delete",
  params: idParamsSchema,
  query: z.object({ version: z.coerce.number().int().min(1).optional() }),
  handler: async ({ db, auth, actor, params, query }) => {
    await deletePurchaseOrder(db, domainCtx(actor, auth), auth.scope, params.id, query.version);
    return { id: params.id, deleted: true };
  },
});
