import type { Metadata } from 'next';
import { ImportsPage } from '@/features/imports/import-pages';

export const metadata: Metadata = { title: 'Import and export' };

export default function Page() {
  return <ImportsPage />;
}
