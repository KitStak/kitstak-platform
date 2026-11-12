/**
 * Export provider for grid "mobile-carts" (Mobile Carts), wired by `src/server/exports/providers/mobile-carts.ts`.
 * Reads the same repository query as the list endpoint, so "Export As Excel" matches
 * the filtered, sorted grid exactly (scope applied by the repository).
 */
import type { ExportProvider, ExportRow } from '@/server/exports/types';
import { listMobileCarts } from './mobile-carts';

export const mobileCartsExport: ExportProvider = {
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listMobileCarts(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};
