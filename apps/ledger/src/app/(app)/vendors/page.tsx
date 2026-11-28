import type { Metadata } from 'next';
import { ScreenPage } from '@/features/routes/screen-page';

export const metadata: Metadata = { title: 'Vendors' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab } = await searchParams;
  return <ScreenPage id="vendors" path="/vendors" tab={typeof tab === 'string' ? tab : undefined} />;
}
