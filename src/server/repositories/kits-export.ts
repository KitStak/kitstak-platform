/** Export providers for the Kit Inventory and Kit Component Availability reports. */
import { KIT_COMPONENT_EXPORT_COLUMNS, KIT_INVENTORY_EXPORT_COLUMNS } from "@/lib/grid-defs/work-orders/kits";
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { listKitComponents, listKitInventory } from "./kits";

export const kitInventoryExportProvider: ExportProvider = {
  columns: KIT_INVENTORY_EXPORT_COLUMNS,
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listKitInventory(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r): ExportRow => ({ ...r })), total };
  },
};

export const kitComponentsExportProvider: ExportProvider = {
  columns: KIT_COMPONENT_EXPORT_COLUMNS,
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listKitComponents(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r): ExportRow => ({ ...r, includedKits: undefined })), total };
  },
};
