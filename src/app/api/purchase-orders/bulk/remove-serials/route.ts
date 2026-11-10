/**
 * `POST /api/purchase-orders/bulk/remove-serials { ids }` — Remove Serial Number: clears the
 * pre-advised serials of each PO (per-id result; received serials stay on their receipts).
 */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { runBulk } from "@/server/domain";
import { purchaseOrdersByIds } from "@/server/repositories/purchase-orders";
import { domainCtx } from "@/server/repositories/platform-common";
import { removePreAdvisedSerials } from "@/server/repositories/purchase-orders-serials";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.remove_serial_number",
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema,
  handler: ({ db, auth, actor, body }) => {
    let removed = 0;
    const result = runBulk(db, body.ids, (tx, id) => {
      removed += removePreAdvisedSerials(tx, domainCtx(actor, auth), auth.scope, id).removed;
    });
    return { ...result, removed, rows: result.succeeded.length ? purchaseOrdersByIds(db, auth.scope, result.succeeded) : [] };
  },
});
