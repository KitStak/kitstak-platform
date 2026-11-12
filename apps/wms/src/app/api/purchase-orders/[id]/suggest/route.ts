/**
 * `GET /api/purchase-orders/[id]/suggest?lineId&qty&lot&expiry&damageReason` — putaway suggestion with reasons.
 * Without `lineId` it returns `{ lines: [...] }`: a suggestion for every open line, sized to its remaining quantity.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { suggestForLine, suggestForOpenLines } from "@/server/repositories/purchase-orders-receive";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.receive_po",
  params: idParamsSchema,
  query: z.object({
    lineId: z.string().trim().max(64, "Line id is too long").optional(),
    qty: z.coerce.number({ message: "Quantity must be a number" }).int("Quantity must be a whole number").min(1, "Quantity must be at least 1").max(1_000_000, "Quantity is too large").default(1),
    lot: z.string().trim().max(100).optional(),
    expiry: z.string().trim().max(40).optional(),
    damageReason: z.string().trim().max(60).optional(),
  }),
  handler: async ({ db, auth, params, query }) =>
    query.lineId
      ? await suggestForLine(db, auth.scope, params.id, query.lineId, query.qty, { lot: query.lot, expiry: query.expiry, damageReason: query.damageReason })
      : { lines: await suggestForOpenLines(db, auth.scope, params.id) },
});
