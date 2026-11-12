import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ScreenConfigListPage } from '@/components/admin/screen-configs/list-page';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Receiving screen configurations' };

async function Guard() {
  await requirePagePermission(
    'settings.screen_configuration.view',
    '/settings/screen-configuration/receiving',
  );
  return <ScreenConfigListPage />;
}

/** `/settings/screen-configuration/receiving` — Receiving configuration list. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
