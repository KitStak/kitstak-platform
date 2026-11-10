/** `GET /api/purchase-orders/labels?ids=a,b[&lineIds=x,y]` — product-label records (qty = ordered) for the print modal. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { productLabelRecords } from "@/server/repositories/purchase-orders-print";

const csv = (max: number) => z.string().trim().max(40_000).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, max));

export const GET = defineRoute({
  permission: "inventory.purchase_orders.product_label",
  query: z.object({ ids: csv(200).pipe(z.array(z.string()).min(1, "Select at least one purchase order")), lineIds: csv(1000).optional() }),
  handler: ({ db, auth, query }) => productLabelRecords(db, auth.scope, query.ids, { lineIds: query.lineIds && query.lineIds.length > 0 ? query.lineIds : undefined }),
});
