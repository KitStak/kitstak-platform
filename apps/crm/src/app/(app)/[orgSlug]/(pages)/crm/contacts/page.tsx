import type { Metadata } from 'next';
import { RecordsIndexPage } from '@/features/crm/records/records-index-page';

export const metadata: Metadata = { title: 'Contacts' };

export default function Page() {
  return <RecordsIndexPage kind="contacts" />;
}
