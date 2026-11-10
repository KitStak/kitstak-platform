/** `POST /api/ops/shipping/rates` — rate shop an order across active carrier connections. */
import { defineRoute } from "@/server/api/define-route";
import { shipping } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { rateShopSchema, SHIPPING_PERMISSIONS } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: SHIPPING_PERMISSIONS.rates,
  transaction: false,
  body: rateShopSchema,
  handler: ({ db, auth, actor, body }) => shipping.rateShop(db, domainCtx(actor, auth), body),
});
