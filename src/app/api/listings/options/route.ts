/** `GET /api/listings/options` — clients, stores and tags for the listing filters. M09. */
import { LISTING_READ_PERMISSIONS } from "@/lib/grid-defs/products/permissions";
import { defineRoute } from "@/server/api/define-route";
import { getListingOptions } from "@/server/repositories/listings";

export const GET = defineRoute({
  permission: LISTING_READ_PERMISSIONS,
  handler: ({ db, auth }) => getListingOptions(db, auth.viewScope),
});
