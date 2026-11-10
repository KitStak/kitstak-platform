/** Import handler "products-update" (owner M09). Updates only the columns that carry a value. */
import { applyProductUpdateImport } from "@/server/repositories/products-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M09",
  apply: (ctx, row) => applyProductUpdateImport(ctx, row),
};
