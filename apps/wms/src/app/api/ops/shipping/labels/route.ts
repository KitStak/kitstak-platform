/** `POST /api/ops/shipping/labels` — buys a shipping label (one shipment per package). */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import { shipping } from '@/server/domain';
import { domainCtx } from '@/server/repositories/platform-common';
import { createLabelSchema, SHIPPING_PERMISSIONS } from '@/server/repositories/platform-ops';

export const POST = defineRoute({
  permission: SHIPPING_PERMISSIONS.labels,
  transaction: false,
  body: createLabelSchema,
  handler: async ({ db, auth, actor, body }) =>
    created(await shipping.createLabel(db, domainCtx(actor, auth), body)),
});
