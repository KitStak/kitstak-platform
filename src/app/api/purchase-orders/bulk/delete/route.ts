/** `POST /api/purchase-orders/bulk/delete { ids }` — Delete Purchase Order (Pending with no receipts only). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { runBulk } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { deletePurchaseOrder } from "@/server/repositories/purchase-orders-commands";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.delete",
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema,
  handler: ({ db, auth, actor, body }) =>
    runBulk(db, body.ids, (tx, id) => {
      deletePurchaseOrder(tx, domainCtx(actor, auth), auth.scope, id);
    }),
});
