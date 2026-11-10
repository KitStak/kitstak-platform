/** `GET /api/orders/code-check?code=&excludeId=` — `{ code, available, suggested }`; no code = next sequence value. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { codeAvailable, peekOrderCode } from "@/server/repositories/orders-commands";

export const GET = defineRoute({
  permission: [ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  query: z.object({ code: z.string().trim().max(50).optional(), excludeId: z.string().max(64).optional() }),
  handler: ({ db, query }) => {
    const suggested = peekOrderCode(db);
    const code = query.code || suggested;
    return { code, available: codeAvailable(db, code, query.excludeId), suggested };
  },
});
