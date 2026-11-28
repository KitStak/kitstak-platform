import type { Metadata } from 'next';
import { ExportPage } from '@/features/imports/export-page';

export const metadata: Metadata = { title: 'Export' };

export default function Page() {
  return <ExportPage />;
}
