/** Import handler "pack-types" (owner M09). Adds or updates a pack type and its barcode; UOM qty > 1 becomes a hierarchical pack over the primary. */
import { applyPackTypeImport } from "@/server/repositories/products-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M09",
  apply: (ctx, row) => applyPackTypeImport(ctx, row),
};
