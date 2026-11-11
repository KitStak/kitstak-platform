/**
 * Export provider for grid "lp-types" (LP Types), wired by `src/server/exports/providers/lp-types.ts`.
 * Reads the same repository query as the list endpoint, so "Export As Excel" matches
 * the filtered, sorted grid exactly (scope applied by the repository).
 */
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { listLpTypes } from "./lp-types";

export const lpTypesExport: ExportProvider = {
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listLpTypes(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};
