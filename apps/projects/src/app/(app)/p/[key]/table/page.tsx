import type { Metadata } from 'next';
import { TableView } from '@/features/table';

export const metadata: Metadata = { title: 'Table' };

export default function Page() {
  return <TableView />;
}
