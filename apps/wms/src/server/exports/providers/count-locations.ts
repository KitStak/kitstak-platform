/**
 * Export provider for grid "count-locations" (M07). Re-exports the module provider from
 * `src/server/repositories/counts-export.ts` (BUILD_PLAN 0.6 stub replaced).
 */
import { countLocationsExport } from '@/server/repositories/counts-export';
import type { ExportProvider } from '../types';

export const exportProvider: ExportProvider | null = countLocationsExport;
