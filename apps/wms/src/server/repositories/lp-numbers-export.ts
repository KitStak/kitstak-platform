/**
 * Export provider for grid "lp-numbers" (LP Numbers), wired by `src/server/exports/providers/lp-numbers.ts`.
 * Reads the same repository query as the list endpoint, so "Export As Excel" matches
 * the filtered, sorted grid exactly (scope applied by the repository).
 */
import type { ExportProvider, ExportRow } from '@/server/exports/types';
import { listLpNumbers } from './lp-numbers';

export const lpNumbersExport: ExportProvider = {
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listLpNumbers(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};
