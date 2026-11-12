/** `POST /api/shipments/[id]/void` — voids one label (and its multi-package group) with the carrier. */
import { defineRoute } from '@/server/api/define-route';
import { AppError, isErrorCode } from '@/server/api/errors';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { voidShipments } from '@/server/repositories/shipping';

export const POST = defineRoute({
  permission: 'fulfillment.shipment_orders.void_label',
  params: idParamsSchema,
  transaction: false,
  handler: async ({ db, auth, actor, params }) => {
    const result = await voidShipments(db, auth, domainCtx(actor, auth), [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(isErrorCode(failure.code) ? failure.code : 'INVALID_STATE', failure.message);
    return result;
  },
});
