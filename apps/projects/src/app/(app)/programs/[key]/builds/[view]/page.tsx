import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BuildsView } from '@/features/programs/builds/builds-view';
import { BUILD_VIEWS } from '@/lib/routes';
import type { BuildView } from '@/lib/program-types';

type Params = Promise<{ key: string; view: string }>;

export const metadata: Metadata = { title: 'Builds' };

/** `/programs/KEY/builds/{runs|board|list|table|calendar|timeline}` (docs/programs/SPEC.md 5.1, 5.7). */
export default async function Page({ params }: { readonly params: Params }) {
  const { view } = await params;
  if (!(BUILD_VIEWS as readonly string[]).includes(view)) notFound();
  return <BuildsView view={view as BuildView} />;
}
