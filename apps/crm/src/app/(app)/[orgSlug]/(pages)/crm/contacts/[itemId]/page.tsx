import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Record360Page } from '@/features/crm/records/record-360-page';

export const metadata: Metadata = { title: 'Contact' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  readonly params: Promise<{ itemId: string }>;
}

export default async function Page({ params }: PageProps) {
  const { itemId } = await params;
  if (!UUID.test(itemId)) notFound();
  return <Record360Page kind="contacts" itemId={itemId} />;
}
