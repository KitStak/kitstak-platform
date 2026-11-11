/** Import handler "locations" (owner M10). Creates one location per row through the wizard's createLocation command (same validation and change log). */
import { applyLocationImport } from "@/server/repositories/locations-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M10",
  apply: async (ctx, row) => await applyLocationImport(ctx, row),
};
