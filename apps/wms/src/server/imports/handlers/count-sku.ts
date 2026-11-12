/**
 * Import handler "count-sku" (owner M07, spec 04 §6 Import SKU Count Plan).
 * Rows with the same Count Plan Name build one Pending SKU count plan.
 */
import { importSkuRow } from "@/server/repositories/counts-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M07",
  apply: async (ctx, row) => await importSkuRow(ctx, row),
};
