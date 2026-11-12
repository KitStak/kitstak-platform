/**
 * `GET /api/inventory/open-orders?productId=&warehouseId=` — 302 to the Orders grid
 * filtered to exactly the open orders that still need this product (Open SO Qty link).
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { notFoundError } from '@/server/api/errors';
import { hasClient } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { openOrdersFor, openOrdersHref } from '@/server/repositories/inventory-open-orders';
import { INVENTORY_PERMISSIONS as P } from '@/lib/grid-defs/inventory/permissions';

const id = z.string().trim().min(1).max(64);

export const GET = defineRoute({
  permission: [P.totalView, P.atpView, P.byLocationView],
  query: z.object({ productId: id, warehouseId: id.optional() }),
  handler: async ({ db, auth, query, request }) => {
    const product = (
      await db
        .select({ sku: schema.products.sku, clientId: schema.products.clientId })
        .from(schema.products)
        .where(eq(schema.products.id, query.productId))
        .limit(1)
    )[0];
    if (!product || !hasClient(auth.scope, product.clientId)) throw notFoundError('Product');
    const orders = await openOrdersFor(db, auth, {
      productId: query.productId,
      warehouseId: query.warehouseId ?? null,
    });
    const href = openOrdersHref(orders, { sku: product.sku, warehouseId: query.warehouseId ?? null });
    return Response.redirect(new URL(href, request.url), 302);
  },
});
