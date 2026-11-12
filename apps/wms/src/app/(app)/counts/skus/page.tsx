import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CountLinesPage } from '@/components/counts/count-lines-page';
import { PageSkeleton } from '@/components/layout/shell-skeleton';

export const metadata: Metadata = { title: 'Count SKU details' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CountLinesPage kind="skus" />
    </Suspense>
  );
}
