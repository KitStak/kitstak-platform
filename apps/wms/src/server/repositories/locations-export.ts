/**
 * Export provider for grid "locations" (Locations), wired by `src/server/exports/providers/locations.ts`.
 * Reads the same repository query as the list endpoint, so "Export As Excel" matches
 * the filtered, sorted grid exactly (scope applied by the repository).
 */
import type { ExportProvider, ExportRow } from '@/server/exports/types';
import { listLocations } from './locations';

export const locationsExport: ExportProvider = {
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listLocations(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};
