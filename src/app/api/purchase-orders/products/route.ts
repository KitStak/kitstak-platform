/** `GET /api/purchase-orders/products?ids=a,b` — pack types, tracking flags and cost for the line editor. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { productInfo } from "@/server/repositories/purchase-orders";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.view",
  query: z.object({
    ids: z.string().trim().min(1).max(20_000).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500)),
  }),
  handler: async ({ db, auth, query }) => await productInfo(db, auth.scope, query.ids),
});
