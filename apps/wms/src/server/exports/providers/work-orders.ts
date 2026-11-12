/** Export provider for grid "work-orders" (Work Orders), owned by M08. */
import { workOrdersExportProvider } from '@/server/repositories/work-orders-export';
import type { ExportProvider } from '../types';

export const exportProvider: ExportProvider | null = workOrdersExportProvider;
