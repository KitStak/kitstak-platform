/**
 * Export provider for grid "shortages" (Shortage Report).
 *
 * STUB (BUILD_PLAN 0.6), owner M03. While this exports `null` the export runner
 * uses the generic provider (exports exactly what the list endpoint returns). The owner
 * replaces it with a re-export of `src/server/repositories/shortages-export.ts`.
 */
import type { ExportProvider } from "../types";

export const exportProvider: ExportProvider | null = null;
