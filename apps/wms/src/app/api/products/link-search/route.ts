/** `GET /api/products/link-search?clientId=&q=` — ranked name/SKU/barcode contains-search for the listing Link drawer. M09. */
import { defineRoute } from '@/server/api/define-route';
import { linkSearchSchema, searchLinkProducts } from '@/server/repositories/products-options';

export const GET = defineRoute({
  permission: ['settings.product_listing.search_a_product', 'settings.products.view'],
  query: linkSearchSchema,
  handler: async ({ db, auth, query }) => await searchLinkProducts(db, auth.scope, query),
});
