/**
 * `GET /api/purchase-orders/labels?ids=a,b[&lineIds=x,y][&perLine=1][&lines=1]` — product-label
 * records for printing: one per ordered unit ("use as line quantity"), or one per line. With
 * `lines=1` it returns one entry per PO line with its ordered / received quantity instead, so
 * the Print Options modal can expand them by the chosen basis.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { productLabelLines, productLabelRecords } from "@/server/repositories/purchase-orders-print";

const csv = (max: number) => z.string().trim().max(40_000).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, max));

export const GET = defineRoute({
  permission: "inventory.purchase_orders.product_label",
  query: z.object({
    ids: csv(200).pipe(z.array(z.string()).min(1, "Select at least one purchase order")),
    lineIds: csv(1000).optional(),
    perLine: z.enum(["1", "0"]).optional(),
    lines: z.enum(["1", "0"]).optional(),
  }),
  handler: ({ db, auth, query }) =>
    query.lines === "1"
      ? productLabelLines(db, auth.scope, query.ids)
      : productLabelRecords(db, auth.scope, query.ids, { lineIds: query.lineIds && query.lineIds.length > 0 ? query.lineIds : undefined, perLine: query.perLine === "1" }),
});
