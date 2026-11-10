/** Import handler "product-capacity" (owner M10). Adds a product capacity (min/max, primary pack type) to a location; rejects an existing one. */
import { applyProductCapacityImport } from "@/server/repositories/locations-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M10",
  apply: (ctx, row) => applyProductCapacityImport(ctx, row),
};
