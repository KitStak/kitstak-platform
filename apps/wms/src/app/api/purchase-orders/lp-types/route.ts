/** `GET /api/purchase-orders/lp-types?warehouseId` — LP types for the PO line editor / Receive items (read-only). */
import { eq } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { assertInScope } from '@/server/auth/scope';
import { lpTypes } from '@/server/db/schema';

export const GET = defineRoute({
  permission: ['inventory.purchase_orders.view'],
  query: z.object({ warehouseId: z.string().trim().min(1).max(64) }),
  handler: async ({ db, auth, query }) => {
    assertInScope(auth.scope, { warehouseId: query.warehouseId }, 'Warehouse');
    return await db
      .select({
        id: lpTypes.id,
        code: lpTypes.code,
        description: lpTypes.description,
        numberPrefix: lpTypes.numberPrefix,
      })
      .from(lpTypes)
      .where(eq(lpTypes.warehouseId, query.warehouseId))
      .orderBy(asc(lpTypes.code));
  },
});
