import type { Metadata } from 'next';
import { PersonPage } from '@/features/people/person-page';

export const metadata: Metadata = { title: 'Person' };

export default async function Page({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: Promise<{ tab?: string | string[] }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <PersonPage personId={id} tab={typeof tab === 'string' ? tab : undefined} />;
}
