/** `POST /api/listings/[id]/dismiss-suggestion` — "Don't match these products" (audited). M09. */
import { defineRoute } from "@/server/api/define-route";
import { dismissSuggestion } from "@/server/repositories/listings";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: "settings.product_listing.search_a_product",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => await dismissSuggestion(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.id),
});
