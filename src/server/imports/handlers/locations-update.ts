/** Import handler "locations-update" (owner M10). Overlays the non-empty cells onto an existing location and saves it through updateLocation. */
import { applyLocationUpdateImport } from "@/server/repositories/locations-import";
import type { ImportHandler } from "../types";

export const handler: ImportHandler = {
  configured: true,
  owner: "M10",
  apply: (ctx, row) => applyLocationUpdateImport(ctx, row),
};
