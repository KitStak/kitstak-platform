/** Import handler "kit-components" (owner M09). Rows for the same kit in one file replace its components. */
import { applyKitComponentImport } from "@/server/repositories/products-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M09",
  apply: (ctx, row) => applyKitComponentImport(ctx, row),
};
