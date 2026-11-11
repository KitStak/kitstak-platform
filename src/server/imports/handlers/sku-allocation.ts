/** Import handler "sku-allocation" (owner M09). Channel allocation (static qty / %) per SKU, channel and warehouse. */
import { applySkuAllocationImport } from "@/server/repositories/products-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M09",
  apply: async (ctx, row) => await applySkuAllocationImport(ctx, row),
};
