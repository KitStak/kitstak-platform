/** `POST /api/ops/shipping/void` `{ shipmentId }` — voids an unshipped label with the carrier. */
import { defineRoute } from '@/server/api/define-route';
import { shipping } from '@/server/domain';
import { domainCtx } from '@/server/repositories/platform-common';
import { SHIPPING_PERMISSIONS, voidLabelSchema } from '@/server/repositories/platform-ops';

export const POST = defineRoute({
  permission: SHIPPING_PERMISSIONS.void,
  transaction: false,
  body: voidLabelSchema,
  handler: ({ db, auth, actor, body }) => shipping.voidLabel(db, domainCtx(actor, auth), body),
});
