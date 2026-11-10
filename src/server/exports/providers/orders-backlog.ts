/** Export provider for grid "orders-backlog" (Shipment Orders) — owned by M01. */
import type { ExportProvider } from "../types";
import { backlogExportProvider } from "@/server/repositories/orders-export";

export const exportProvider: ExportProvider | null = backlogExportProvider;
