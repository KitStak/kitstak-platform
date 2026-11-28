import type { Metadata } from 'next';
import { PeoplePage, type PeopleSearch } from '@/features/people/people-page';

export const metadata: Metadata = { title: 'People' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const one = (key: string): string | undefined => (typeof raw[key] === 'string' ? (raw[key] as string) : undefined);
  const search: PeopleSearch = { q: one('q'), site: one('site'), kind: one('kind'), status: one('status'), agency: one('agency'), class: one('class') };
  return <PeoplePage search={search} />;
}
