/**
 * Export provider for grid "shipment-packages" (Shipment Packages), wired by `src/server/exports/providers/shipment-packages.ts`.
 * Reads the same repository query as the list endpoint, so "Export As Excel" matches
 * the filtered, sorted grid exactly (scope applied by the repository).
 */
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { listShipmentPackages } from "./shipment-packages";

export const shipmentPackagesExport: ExportProvider = {
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listShipmentPackages(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};
