/** `POST /api/listings/[id]/link` { productId, version? } — link a listing to a product. M09. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { linkListing } from '@/server/repositories/listings';
import { domainCtx, idParamsSchema, idSchema, versionSchema } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: 'settings.product_listing.search_a_product',
  params: idParamsSchema,
  body: z.object({ productId: idSchema, version: versionSchema.optional() }),
  handler: async ({ db, auth, actor, params, body }) =>
    await linkListing(
      db,
      { ...domainCtx(actor, auth), scope: auth.scope },
      params.id,
      body.productId,
      body.version,
    ),
});
