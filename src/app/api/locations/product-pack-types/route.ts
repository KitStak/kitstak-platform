/** `GET /api/locations/product-pack-types?productId=` — the product's pack types for the capacity modal. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { productPackTypesFor } from "@/server/repositories/locations";

export const GET = defineRoute({
  permission: ["settings.locations.create", "settings.locations.edit", "settings.locations.assign_capacity"],
  query: z.object({ productId: z.string().trim().min(1).max(64) }),
  handler: async ({ db, query }) => await productPackTypesFor(db, query.productId),
});
