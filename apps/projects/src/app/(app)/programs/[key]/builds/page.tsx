import type { Metadata } from 'next';
import { BuildsRedirect } from '@/features/programs/builds/builds-redirect';

type Params = Promise<{ key: string }>;

export const metadata: Metadata = { title: 'Builds' };

/** `/programs/KEY/builds` opens the last used view (localStorage), else Runs (docs/programs/SPEC.md 5.1). */
export default async function Page({ params }: { readonly params: Params }) {
  const { key } = await params;
  return <BuildsRedirect programKey={decodeURIComponent(key).toUpperCase()} />;
}
