import type { Metadata } from 'next';
import { LinkedTab } from '@/features/programs/linked/linked-tab';
import { getProgramDetail, listRecordLinksFor } from '@/server/domain/programs';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string }>;

export const metadata: Metadata = { title: 'Linked' };

/** Linked tab (docs/programs/SPEC.md 5.14). `?link=pulse` opens the Pulse job picker. */
export default async function Page({ params }: { readonly params: Params }) {
  const { key } = await params;
  const programKey = decodeURIComponent(key).toUpperCase();
  const { ctx } = await pageContext(`/programs/${programKey}/linked`);
  const program = await getProgramDetail(ctx, programKey);
  return <LinkedTab initialLinks={await listRecordLinksFor(ctx, { type: 'pm_program', id: program.id })} />;
}
