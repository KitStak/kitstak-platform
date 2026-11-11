/**
 * `POST /api/listings/[id]/create-product` — create a product for the listing and link it. M09.
 * - No body: create (or reuse) the client's product with the seller SKU (one-click, beyond Logiwa).
 * - `{ product, version? }`: the Link Product drawer's "Create New" quick form; the product goes
 *   through the full wizard validation, then the listing is linked and Never Sync applied.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { createProductFromListing, createQuickProductForListing } from "@/server/repositories/listings";
import { domainCtx, idParamsSchema, versionSchema } from "@/server/repositories/platform-common";
import type { ListingQuickProductInput } from "@/lib/grid-defs/products/listing-quick-product";

export const POST = defineRoute({
  permission: "settings.products.create",
  params: idParamsSchema,
  body: z.object({ product: z.record(z.string().max(40), z.unknown()).optional(), version: versionSchema.optional() }),
  handler: async ({ db, auth, actor, params, body }) => {
    const ctx = { ...domainCtx(actor, auth), scope: auth.scope };
    return created(body.product
      ? await createQuickProductForListing(db, ctx, params.id, body.product as ListingQuickProductInput, body.version)
      : await createProductFromListing(db, ctx, params.id));
  },
});
