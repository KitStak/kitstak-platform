/** `POST /api/ops/shipping/ship` `{ ids, shipDate?, requireLabel? }` — ships orders; per-id bulk result. */
import { defineRoute } from "@/server/api/define-route";
import { shipping } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { SHIPPING_PERMISSIONS, shipOrdersSchema } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: SHIPPING_PERMISSIONS.ship,
  body: shipOrdersSchema,
  handler: async ({ db, auth, actor, body }) =>
    await shipping.shipOrders(db, domainCtx(actor, auth), { orderIds: body.ids, shipDate: body.shipDate, requireLabel: body.requireLabel }),
});
