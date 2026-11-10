/**
 * `POST /api/purchase-orders/[id]/receive` — Receive Items (partial receive per line) or,
 * with `{ all: true }`, a full receive into the warehouse's default receiving location.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { receiveBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { receiveAll, receivePurchaseOrder } from "@/server/repositories/purchase-orders-receive";

const body = z.union([z.object({ all: z.literal(true) }), receiveBodySchema]);

export const POST = defineRoute({
  permission: "inventory.purchase_orders.receive_po",
  params: idParamsSchema,
  body,
  handler: ({ db, auth, actor, params, body: input }) => {
    const ctx = domainCtx(actor, auth);
    return "all" in input ? receiveAll(db, ctx, auth.scope, params.id) : receivePurchaseOrder(db, ctx, auth.scope, params.id, input);
  },
});
