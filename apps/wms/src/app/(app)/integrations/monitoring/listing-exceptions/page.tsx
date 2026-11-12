import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ListingExceptionsPage } from '@/components/integrations/monitoring/monitoring-review-pages';

export const metadata: Metadata = { title: 'Product Listing Exceptions' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ListingExceptionsPage />
    </Suspense>
  );
}
