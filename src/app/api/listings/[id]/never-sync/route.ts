/** `POST /api/listings/[id]/never-sync` { neverSync } — exclude a listing from inventory push. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { setNeverSync } from "@/server/repositories/listings";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: "settings.product_listing.search_a_product",
  params: idParamsSchema,
  body: z.object({ neverSync: z.boolean() }),
  handler: async ({ db, auth, actor, params, body }) => await setNeverSync(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.id, body.neverSync),
});
