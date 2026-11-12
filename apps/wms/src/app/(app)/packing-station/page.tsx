import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { PackingDashboard } from '@/components/packing/packing-dashboard';

export const metadata: Metadata = { title: 'Packing station' };

/** Packing Station dashboard (M04 §1). */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PackingDashboard />
    </Suspense>
  );
}
