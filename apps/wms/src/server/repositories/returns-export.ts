/** Export provider for the Return Orders grid (one sheet row per RMA line). */
import { RETURN_EXPORT_COLUMNS } from "@/lib/grid-defs/returns/return-orders";
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { listReturnLines } from "./returns-grid";

export const returnOrdersExportProvider: ExportProvider = {
  columns: RETURN_EXPORT_COLUMNS,
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listReturnLines(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};
