/**
 * Export provider for grid "dev-ui-orders" (/dev/ui showcase). Evaluates the grid query
 * over the same rows the page renders (viewer's context scope), so the workbook matches
 * the filtered grid total exactly.
 */
import { DEV_SEARCH_FIELDS, devOrderField } from "@/lib/dev-orders";
import { applyLocalGridQuery } from "@/lib/local-grid-query";
import { loadDevOrders } from "@/server/dev/dev-orders";
import type { ExportProvider, ExportRow } from "../types";

export const exportProvider: ExportProvider | null = {
  columns: [
    { key: "code", label: "Order Code" },
    { key: "status", label: "Status" },
    { key: "clientName", label: "Client" },
    { key: "channel", label: "Channel" },
    { key: "storeOrderNumber", label: "Store Order #" },
    { key: "customerName", label: "Customer" },
    { key: "shipState", label: "State" },
    { key: "priority", label: "Priority" },
    { key: "totalQuantity", label: "Qty", type: "integer" },
    { key: "salesPrice", label: "Sales Price", type: "money" },
    { key: "orderDate", label: "Order Date", type: "datetime" },
    { key: "trackingNumber", label: "Tracking #" },
  ],
  async fetchPage(ctx, page, pageSize) {
    const rows = await loadDevOrders(ctx.db, ctx.auth.viewScope);
    const result = applyLocalGridQuery(rows, { ...ctx.query, page, pageSize }, { get: devOrderField, searchFields: DEV_SEARCH_FIELDS });
    const rowsOut: readonly ExportRow[] = result.rows.map((row) => ({ ...row }));
    return { rows: rowsOut, total: result.total };
  },
};
