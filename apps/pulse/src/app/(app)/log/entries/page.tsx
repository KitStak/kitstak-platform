import type { Metadata } from 'next';
import { LogEntriesPage } from '@/features/log';

export const metadata: Metadata = { title: 'All entries' };

export default function Page() {
  return <LogEntriesPage />;
}
