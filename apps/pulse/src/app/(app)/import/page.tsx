import type { Metadata } from 'next';
import { ImportsPage } from '@/features/imports';

export const metadata: Metadata = { title: 'Import' };

export default function Page() {
  return <ImportsPage />;
}
