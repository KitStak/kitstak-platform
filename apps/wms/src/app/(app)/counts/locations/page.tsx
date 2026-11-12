import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CountLinesPage } from '@/components/counts/count-lines-page';
import { PageSkeleton } from '@/components/layout/shell-skeleton';

export const metadata: Metadata = { title: 'Count location details' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CountLinesPage kind="locations" />
    </Suspense>
  );
}
