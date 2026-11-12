import type { Metadata } from 'next';
import { RecordsIndexPage } from '@/features/crm/records/records-index-page';

export const metadata: Metadata = { title: 'Accounts' };

export default function Page() {
  return <RecordsIndexPage kind="accounts" />;
}
