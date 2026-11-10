/**
 * `GET /api/listings/exceptions?kind=` — open product listing exceptions (Missing product,
 * SKU difference, Multi listing) for M12 "Product Listing Exceptions". Derived from
 * `product_listings`, so linking a listing clears its exception immediately. M09.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listListingExceptions } from "@/server/repositories/listings";
import { LISTING_EXCEPTIONS } from "@/lib/grid-defs/products/listings-grid";

export const GET = defineRoute({
  permission: "settings.product_listing.view",
  query: z.object({ kind: z.enum(LISTING_EXCEPTIONS).optional() }).loose(),
  handler: ({ db, auth, query }) => listListingExceptions(db, auth.viewScope, query.kind),
});
