import type { Metadata } from 'next';
import { InboxPage } from '@/features/inbox';

export const metadata: Metadata = { title: 'Inbox' };

export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const { filter } = await searchParams;
  return <InboxPage filter={filter} />;
}
