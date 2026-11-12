import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ReturnProcessPage } from '@/components/admin/data-setup/return-process-page';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Return Process' };

async function Guard() {
  await requirePagePermission('settings.data_setup.view', '/settings/data-setup/return-process');
  return <ReturnProcessPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
