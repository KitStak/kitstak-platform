/** `GET /api/orders/product-facts?ids=a,b&warehouseId=` — price, weight, kit flag, pack types and live ATP for wizard lines. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { productFacts } from '@/server/repositories/orders-wizard';

export const GET = defineRoute({
  permission: [ORDER_PERMISSIONS.create, ORDER_PERMISSIONS.edit],
  query: z.object({
    ids: z
      .string()
      .max(20_000)
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().max(64)).max(500)),
    warehouseId: z.string().max(64).optional(),
  }),
  handler: async ({ db, auth, query }) => await productFacts(db, auth.scope, query),
});
