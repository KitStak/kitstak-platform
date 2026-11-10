/** `GET /api/listings/options` — clients, stores and tags for the listing filters. M09. */
import { defineRoute } from "@/server/api/define-route";
import { getListingOptions } from "@/server/repositories/listings";

export const GET = defineRoute({
  permission: "settings.product_listing.view",
  handler: ({ db, auth }) => getListingOptions(db, auth.viewScope),
});
