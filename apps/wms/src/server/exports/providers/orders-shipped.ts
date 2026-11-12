/** Export provider for grid "orders-shipped" (Shipped & Canceled Orders) — owned by M01. */
import type { ExportProvider } from "../types";
import { shippedExportProvider } from "@/server/repositories/orders-export";

export const exportProvider: ExportProvider | null = shippedExportProvider;
