import type { Metadata } from 'next';
import { ExportPage } from '@/features/export';

export const metadata: Metadata = { title: 'Export' };

export default function Page() {
  return <ExportPage />;
}
