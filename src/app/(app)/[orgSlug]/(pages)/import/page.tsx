import type { Metadata } from 'next';
import { ImportPage } from '@/features/import-export';

export const metadata: Metadata = { title: 'Import data' };

export default function Page() {
  return <ImportPage />;
}
