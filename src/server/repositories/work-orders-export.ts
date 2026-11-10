/** Export provider for the Work Orders grid (async "Export As Excel"). */
import { WORK_ORDER_COLUMNS } from "@/lib/grid-defs/work-orders/work-orders";
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { listWorkOrders } from "./work-orders";

export const workOrdersExportProvider: ExportProvider = {
  columns: WORK_ORDER_COLUMNS,
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listWorkOrders(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r): ExportRow => ({ ...r, tags: undefined, customFields: undefined })), total };
  },
};
