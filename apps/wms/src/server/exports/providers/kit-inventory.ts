/** Export provider for grid "kit-inventory" (Kit Inventory), owned by M08. */
import { kitInventoryExportProvider } from '@/server/repositories/kits-export';
import type { ExportProvider } from '../types';

export const exportProvider: ExportProvider | null = kitInventoryExportProvider;
