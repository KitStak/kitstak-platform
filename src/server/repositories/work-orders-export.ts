/**
 * Export provider for the Work Orders grid (async "Export As Excel"). Timestamps follow the M08
 * time-zone policy: warehouse zone with a zone suffix ("11/09/2026 11:43 PM CST"), exactly as
 * the grid and detail page show them. Excel date cells carry no zone, so they go out as text.
 */
import { WORK_ORDER_COLUMNS } from "@/lib/grid-defs/work-orders/work-orders";
import { formatInZone } from "@/lib/grid-defs/work-orders/wo-time";
import type { ExportColumn, ExportProvider, ExportRow } from "@/server/exports/types";
import { listWorkOrders } from "./work-orders";

const DATETIME_KEYS = new Set(WORK_ORDER_COLUMNS.filter((c) => c.type === "datetime").map((c) => c.key));

export const WORK_ORDER_EXPORT_COLUMNS: readonly ExportColumn[] = WORK_ORDER_COLUMNS.map((c) => (DATETIME_KEYS.has(c.key) ? { ...c, label: `${c.label} (warehouse time)`, type: "text" as const } : c));

export const workOrdersExportProvider: ExportProvider = {
  columns: WORK_ORDER_EXPORT_COLUMNS,
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listWorkOrders(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize });
    return {
      rows: rows.map((r): ExportRow => {
        const out: Record<string, unknown> = { ...r, tags: undefined, customFields: undefined };
        for (const key of DATETIME_KEYS) {
          const v = (r as unknown as Record<string, unknown>)[key];
          out[key] = typeof v === "string" && v ? formatInZone(v, r.warehouseTimeZone) : null;
        }
        return out as ExportRow;
      }),
      total,
    };
  },
};
