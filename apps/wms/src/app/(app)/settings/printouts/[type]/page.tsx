import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { PrintoutListPage } from '@/components/admin/printouts/printout-list-page';
import { getPrintType } from '@/server/print/catalog';
import { requirePagePermission } from '@/server/auth/permissions';

interface Props {
  readonly params: Promise<{ type: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  return { title: getPrintType(type)?.name ?? 'Printouts & Labels' };
}

async function Body({ params }: Props) {
  const { type } = await params;
  if (!getPrintType(type)) notFound();
  await requirePagePermission('settings.printouts_labels.view', `/settings/printouts/${type}`);
  return <PrintoutListPage typeKey={type} />;
}

/** `/settings/printouts/[type]` — templates of one printout type (M14 #8). */
export default function Page(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Body {...props} />
    </Suspense>
  );
}
