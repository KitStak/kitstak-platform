/** `GET /api/purchase-orders/code-check?code&excludeId` — inline PO number uniqueness (step 1). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { poCodeTaken } from '@/server/repositories/purchase-orders';
import { duplicateCodeMessage } from '@/server/repositories/purchase-orders-commands';

export const GET = defineRoute({
  permission: ['inventory.purchase_orders.create', 'inventory.purchase_orders.edit'],
  query: z.object({
    code: z.string().trim().min(1).max(50),
    excludeId: z.string().trim().max(64).optional(),
  }),
  handler: async ({ db, query }) => {
    const hit = await poCodeTaken(db, query.code, query.excludeId);
    return {
      code: query.code,
      taken: hit.taken,
      message: hit.taken ? duplicateCodeMessage(query.code) : null,
    };
  },
});
