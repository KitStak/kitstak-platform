/** `POST /api/purchase-orders/bulk/cancel { ids }` — per-id result (Pending / Started only). */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { runBulk } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { cancelPurchaseOrder } from "@/server/repositories/purchase-orders-commands";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.cancel_order",
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema,
  handler: ({ db, auth, actor, body }) =>
    runBulk(db, body.ids, (tx, id) => {
      cancelPurchaseOrder(tx, domainCtx(actor, auth), auth.scope, id);
    }),
});
