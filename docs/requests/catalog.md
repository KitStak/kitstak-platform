# M09 catalog — requests

## REQ-1
- **File:** `src/app/(app)/integrations/monitoring/listing-exceptions/page.tsx` (owned by M12, not a shared primitive; handoff note only).
- **Change:** build the "Product Listing Exceptions" grid on `GET /api/listings/exceptions?kind=unlinked|sku_difference|multi_listing`
  (M09, permission `settings.product_listing.view`). It returns `{ rows: ListingExceptionRow[], counts }`; rows link to
  `/products/listings?link=<linked|unlinked>` and `/products/[productId]`. Repository: `listListingExceptions` in `src/server/repositories/listings.ts`.
- **Reason:** acceptance "linking an unlinked listing … clears its Listing Exception in M12 monitoring". Exceptions are derived from
  `product_listings`, so the M12 page needs no table of its own and clears as soon as M09 links a listing.
- **Status:** not a shared change (F-patch 2026-11-06): handoff note for M12, which owns `src/app/(app)/integrations/monitoring/listing-exceptions/page.tsx`. Nothing to apply in shared files; the export key `monitoring-listing-exceptions` is registered (automation-integrations REQ-2).
