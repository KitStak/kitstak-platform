/**
 * Export provider for grid "integration-orders" (Orders and Shipments).
 *
 * STUB (BUILD_PLAN 0.6), owner M12. While this exports `null` the export runner
 * uses the generic provider (exports exactly what the list endpoint returns). The owner
 * replaces it with a re-export of `src/server/repositories/integration-logs-export.ts`.
 */
import type { ExportProvider } from '../types';

export const exportProvider: ExportProvider | null = null;
