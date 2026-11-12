/** `POST /api/purchase-orders/bulk/receive { ids }` — full receive of each PO into its default receiving location. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { runBulk } from "@/server/domain";
import { purchaseOrdersByIds } from "@/server/repositories/purchase-orders";
import { domainCtx } from "@/server/repositories/platform-common";
import { receiveAll } from "@/server/repositories/purchase-orders-receive";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.receive_po",
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema,
  handler: async ({ db, auth, actor, body }) => {
    const result = await runBulk(db, body.ids, async (tx, id) => {
      await receiveAll(tx, domainCtx(actor, auth), auth.scope, id);
    });
    // The refreshed rows let the list patch its cache at once (no stale status / actions).
    return { ...result, rows: result.succeeded.length ? await purchaseOrdersByIds(db, auth.scope, result.succeeded) : [] };
  },
});
