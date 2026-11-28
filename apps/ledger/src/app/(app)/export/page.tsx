import type { Metadata } from 'next';
import { ExportPage } from '@/features/imports/import-pages';

export const metadata: Metadata = { title: 'Export data' };

export default function Page() {
  return <ExportPage />;
}
