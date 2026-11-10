/** `GET /api/purchase-orders/[id]/suggest?lineId&qty&lot&expiry&damageReason` — putaway suggestion with reasons. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { suggestForLine } from "@/server/repositories/purchase-orders-receive";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.receive_po",
  params: idParamsSchema,
  query: z.object({
    lineId: z.string().trim().min(1).max(64),
    qty: z.coerce.number().int().min(1).max(1_000_000).default(1),
    lot: z.string().trim().max(100).optional(),
    expiry: z.string().trim().max(40).optional(),
    damageReason: z.string().trim().max(60).optional(),
  }),
  handler: ({ db, auth, params, query }) =>
    suggestForLine(db, auth.scope, params.id, query.lineId, query.qty, { lot: query.lot, expiry: query.expiry, damageReason: query.damageReason }),
});
