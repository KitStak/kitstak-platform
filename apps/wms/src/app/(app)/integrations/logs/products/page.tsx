import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { CallLogsPage } from '@/components/integrations/logs/logs-pages';

export const metadata: Metadata = { title: 'Products and Inventory' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CallLogsPage kind="products" />
    </Suspense>
  );
}
