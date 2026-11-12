/** `GET /api/purchase-orders/[id]/receipts` — receipts posted against the PO. */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { getPurchaseOrder } from '@/server/repositories/purchase-orders';
import { receiptsForPurchaseOrder } from '@/server/repositories/receipts';

export const GET = defineRoute({
  permission: 'inventory.purchase_orders.view',
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => {
    await getPurchaseOrder(db, auth.scope, params.id);
    return await receiptsForPurchaseOrder(db, auth.scope, params.id);
  },
});
