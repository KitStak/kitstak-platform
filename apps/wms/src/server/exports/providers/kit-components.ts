/** Export provider for grid "kit-components" (Kit Component Inventory Availability), owned by M08. */
import { kitComponentsExportProvider } from '@/server/repositories/kits-export';
import type { ExportProvider } from '../types';

export const exportProvider: ExportProvider | null = kitComponentsExportProvider;
