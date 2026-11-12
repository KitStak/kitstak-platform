/** Import handler "listings" (owner M09). Upserts product listings by store + seller SKU, linking them when SKU is given. */
import { applyListingImport } from "@/server/repositories/products-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M09",
  apply: async (ctx, row) => await applyListingImport(ctx, row),
};
