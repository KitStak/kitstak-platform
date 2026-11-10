/** `POST /api/listings/[id]/create-product` — create the product from the listing and link it. M09. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { createProductFromListing } from "@/server/repositories/listings";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: "settings.products.create",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => created(createProductFromListing(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.id)),
});
