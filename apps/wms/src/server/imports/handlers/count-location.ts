/**
 * Import handler "count-location" (owner M07, spec 04 §6 Import Location Count Plan).
 * Rows with the same Count Plan Name build one Pending Location count plan.
 */
import { importLocationRow } from "@/server/repositories/counts-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M07",
  apply: async (ctx, row) => await importLocationRow(ctx, row),
};
