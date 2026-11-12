import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ScreenConfigSplashPage } from '@/components/admin/screen-configs/splash-page';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Screen Configuration' };

async function Guard() {
  await requirePagePermission('settings.screen_configuration.view', '/settings/screen-configuration');
  return <ScreenConfigSplashPage />;
}

/** `/settings/screen-configuration` — operation type splash (M14 #9). */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
