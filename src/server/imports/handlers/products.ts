/** Import handler "products" (owner M09). Creates standard products through the wizard command (same validation and change log). */
import { applyProductImport } from "@/server/repositories/products-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M09",
  apply: (ctx, row) => applyProductImport(ctx, row),
};
