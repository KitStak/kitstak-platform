/** `GET /api/purchase-orders/documents?ids=a,b[&download=1]` — Purchase Order document(s) as one PDF. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { renderPurchaseOrderDocuments } from "@/server/repositories/purchase-orders-print";

export const GET = defineRoute({
  permission: ["inventory.purchase_orders.purchase_order_label", "inventory.purchase_orders.view"],
  query: z.object({
    ids: z.string().trim().min(1).max(40_000).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200)),
    download: z.enum(["1", "0"]).optional(),
  }),
  handler: async ({ db, auth, query }) => {
    const bytes = await renderPurchaseOrderDocuments(db, auth.scope, query.ids);
    const name = query.ids.length === 1 ? "purchase-order.pdf" : "purchase-orders.pdf";
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${query.download === "1" ? "attachment" : "inline"}; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  },
});
