import type { Metadata } from 'next';
import { BuildTicketsPage } from '@/features/programs/reports/build-tickets-page';

type Params = Promise<{ key: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Build tickets' };

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);

/** `/programs/KEY/tickets?run=&from=&to=` (docs/programs/SPEC.md 5.1, 5.20). */
export default async function Page({ params, searchParams }: { readonly params: Params; readonly searchParams: Search }) {
  const [{ key }, search] = await Promise.all([params, searchParams]);
  return <BuildTicketsPage programKey={decodeURIComponent(key).toUpperCase()} run={one(search.run)} from={one(search.from)} to={one(search.to)} />;
}
