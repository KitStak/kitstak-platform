/**
 * `POST /api/purchase-orders/bulk/cancel { ids }` — per-id result (Pending / Started only).
 * POs with receipts are short-closed (open balance cancelled, received stock kept, Completed);
 * their ids come back in `shortClosed`.
 */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { runBulk } from "@/server/domain";
import { purchaseOrdersByIds } from "@/server/repositories/purchase-orders";
import { domainCtx } from "@/server/repositories/platform-common";
import { cancelPurchaseOrderOutcome } from "@/server/repositories/purchase-orders-commands";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.cancel_order",
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema,
  handler: ({ db, auth, actor, body }) => {
    const shortClosed: string[] = [];
    const result = runBulk(db, body.ids, (tx, id) => {
      if (cancelPurchaseOrderOutcome(tx, domainCtx(actor, auth), auth.scope, id).shortClosed) shortClosed.push(id);
    });
    const ok = new Set(result.succeeded);
    // The refreshed rows let the list patch its cache at once (no stale status / actions).
    return { ...result, shortClosed: shortClosed.filter((id) => ok.has(id)), rows: result.succeeded.length ? purchaseOrdersByIds(db, auth.scope, result.succeeded) : [] };
  },
});
