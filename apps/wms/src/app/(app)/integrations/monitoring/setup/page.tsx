import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { SetupDetailsPage } from '@/components/integrations/monitoring/monitoring-overview-pages';

export const metadata: Metadata = { title: 'Channel Setup Details' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SetupDetailsPage />
    </Suspense>
  );
}
