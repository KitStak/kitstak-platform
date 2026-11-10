/** `POST /api/listings/[id]/unlink` — remove the product link. M09. */
import { defineRoute } from "@/server/api/define-route";
import { unlinkListing } from "@/server/repositories/listings";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: "settings.product_listing.search_a_product",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => unlinkListing(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.id),
});
