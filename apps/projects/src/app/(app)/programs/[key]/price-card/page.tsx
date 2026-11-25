import type { Metadata } from 'next';
import { PriceCardTab } from '@/features/programs/price-card/price-card-tab';
import { listCardVersions } from '@/server/domain/programs';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string }>;

export const metadata: Metadata = { title: 'Price card' };

/** Price card tab (docs/programs/SPEC.md 5.12). `?version=<id>` opens a version, `?new=1` starts one. */
export default async function Page({ params }: { readonly params: Params }) {
  const { key } = await params;
  const programKey = decodeURIComponent(key).toUpperCase();
  const { ctx } = await pageContext(`/programs/${programKey}/price-card`);
  const versions = await listCardVersions(ctx, programKey);
  return <PriceCardTab initialVersions={versions} />;
}
