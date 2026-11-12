/**
 * `POST /api/purchase-orders/[id]/cancel` — Cancel Order (Pending / Started only). A PO
 * without receipts becomes Cancelled; a Started PO with receipts is short-closed: the open
 * balance is cancelled, received lines and stock are kept, and it closes as Completed.
 * The response is the refreshed detail plus `shortClosed` / `cancelledUnits`.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { getPurchaseOrder } from '@/server/repositories/purchase-orders';
import { cancelPurchaseOrderOutcome } from '@/server/repositories/purchase-orders-commands';

export const POST = defineRoute({
  permission: 'inventory.purchase_orders.cancel_order',
  params: idParamsSchema,
  body: z.object({ version: z.number().int().min(1).optional() }),
  handler: async ({ db, auth, actor, params, body }) => {
    const outcome = await cancelPurchaseOrderOutcome(
      db,
      domainCtx(actor, auth),
      auth.scope,
      params.id,
      body.version,
    );
    return {
      ...(await getPurchaseOrder(db, auth.scope, params.id)),
      shortClosed: outcome.shortClosed,
      cancelledUnits: outcome.cancelledUnits,
    };
  },
});
