import type { Metadata } from 'next';
import { LogBulkPage } from '@/features/log';

export const metadata: Metadata = { title: 'Log many days' };

export default function Page() {
  return <LogBulkPage />;
}
