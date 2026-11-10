/** Import handler "product-capacity-update" (owner M10). Changes an existing product capacity on a location. */
import { applyProductCapacityUpdateImport } from "@/server/repositories/locations-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M10",
  apply: (ctx, row) => applyProductCapacityUpdateImport(ctx, row),
};
