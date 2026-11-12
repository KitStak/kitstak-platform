/**
 * Export provider for grid "return-orders" (Return Orders). Owner M04 — re-exports
 * `src/server/repositories/returns-export.ts` (BUILD_PLAN 0.6).
 */
import { returnOrdersExportProvider } from "@/server/repositories/returns-export";
import type { ExportProvider } from "../types";

export const exportProvider: ExportProvider | null = returnOrdersExportProvider;
