import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { CallLogsPage } from '@/components/integrations/logs/logs-pages';

export const metadata: Metadata = { title: 'Orders and Shipments' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CallLogsPage kind="orders" />
    </Suspense>
  );
}
