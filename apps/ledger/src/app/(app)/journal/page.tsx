import type { Metadata } from 'next';
import { ScreenPage } from '@/features/routes/screen-page';

export const metadata: Metadata = { title: 'Journal' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab } = await searchParams;
  return <ScreenPage id="journal" path="/journal" tab={typeof tab === 'string' ? tab : undefined} />;
}
