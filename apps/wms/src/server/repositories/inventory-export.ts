/**
 * Export providers for the three inventory grids (BUILD_PLAN 0.6). They run the same
 * scoped grid queries as the list endpoints, with typed sheet columns.
 */
import type { ExportPage, ExportProvider } from "@/server/exports/types";
import { ATP_EXPORT_COLUMNS } from "@/lib/grid-defs/inventory/atp";
import { BY_LOCATION_EXPORT_COLUMNS } from "@/lib/grid-defs/inventory/by-location";
import { TOTAL_INVENTORY_EXPORT_COLUMNS } from "@/lib/grid-defs/inventory/total-inventory";
import { listAtp } from "./inventory-atp";
import { listBuckets } from "./inventory-by-location";
import { listTotalInventory } from "./inventory-total";

const toPage = <T extends object>(p: { rows: readonly T[]; total: number }): ExportPage => ({ rows: p.rows as unknown as ExportPage["rows"], total: p.total });

export const totalInventoryExport: ExportProvider = {
  columns: TOTAL_INVENTORY_EXPORT_COLUMNS,
  fetchPage: async (ctx, page, pageSize) => toPage(await listTotalInventory(ctx.db, ctx.auth, { ...ctx.query, page, pageSize })),
};

export const byLocationExport: ExportProvider = {
  columns: BY_LOCATION_EXPORT_COLUMNS,
  fetchPage: async (ctx, page, pageSize) => toPage(await listBuckets(ctx.db, ctx.auth, { ...ctx.query, page, pageSize })),
};

export const atpExport: ExportProvider = {
  columns: ATP_EXPORT_COLUMNS,
  fetchPage: async (ctx, page, pageSize) => toPage(await listAtp(ctx.db, ctx.auth, { ...ctx.query, page, pageSize })),
};
